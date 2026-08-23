// Package olcrtc provisions server-side state for the "olcrtc" kernel:
// https://github.com/openlibrecommunity/olcrtc
//
// An olcrtc config describes a single room/session (mode: srv) rather than
// a list of users, so — like the other three kernels — the panel runs one
// dedicated process per profile instead of sharing one.
package olcrtc

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"gopkg.in/yaml.v3"

	"wtpanel/internal/config"
	"wtpanel/internal/models"
	"wtpanel/internal/provisioner/common"
)

type Provisioner struct {
	cfg     *config.Config
	dataDir string

	mu          sync.Mutex
	supervisors map[uint]*common.ProcessSupervisor // keyed by profile ID
}

func New(cfg *config.Config) *Provisioner {
	return &Provisioner{
		cfg:         cfg,
		dataDir:     filepath.Join(cfg.DataDir, "olcrtc"),
		supervisors: make(map[uint]*common.ProcessSupervisor),
	}
}

func (p *Provisioner) Type() models.CoreType { return models.CoreOlcRTC }

func (p *Provisioner) AddProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.parseConfig(profile)
	if err != nil {
		return "", err
	}
	if cc.CryptoKey == "" {
		key, err := common.RandomHexKey(32)
		if err != nil {
			return "", fmt.Errorf("generate olcrtc crypto key: %w", err)
		}
		cc.CryptoKey = key
	}

	return p.writeAndStart(profile, cc, false)
}

func (p *Provisioner) UpdateProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.parseConfig(profile)
	if err != nil {
		return "", err
	}
	if cc.CryptoKey == "" {
		// No prior key on record — mint one rather than starting keyless.
		key, err := common.RandomHexKey(32)
		if err != nil {
			return "", fmt.Errorf("generate olcrtc crypto key: %w", err)
		}
		cc.CryptoKey = key
	}

	return p.writeAndStart(profile, cc, true)
}

func (p *Provisioner) Restore(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.parseConfig(profile)
	if err != nil {
		return err
	}
	if cc.CryptoKey == "" {
		return fmt.Errorf("profile %s has no olcrtc crypto key to restore", profile.ExternalID)
	}
	_, err = p.writeAndStart(profile, cc, false)
	return err
}

func (p *Provisioner) RemoveProfile(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if sup, ok := p.supervisors[profile.ID]; ok {
		_ = sup.Stop()
		delete(p.supervisors, profile.ID)
	}
	return os.Remove(p.configPath(profile.ExternalID))
}

func (p *Provisioner) Status(profile *models.Profile) (bool, int) {
	p.mu.Lock()
	sup, ok := p.supervisors[profile.ID]
	p.mu.Unlock()
	if !ok {
		return false, 0
	}
	return sup.IsRunning(), sup.PID()
}

func (p *Provisioner) Logs(profile *models.Profile, maxBytes int) (string, error) {
	p.mu.Lock()
	sup, ok := p.supervisors[profile.ID]
	p.mu.Unlock()
	if !ok {
		return "", nil
	}
	return sup.ReadLog(maxBytes)
}

func (p *Provisioner) Restart(profile *models.Profile) error {
	p.mu.Lock()
	sup, ok := p.supervisors[profile.ID]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("profile %s has no tracked process to restart", profile.ExternalID)
	}
	return sup.Restart()
}

func (p *Provisioner) Shutdown() {
	p.mu.Lock()
	sups := make([]*common.ProcessSupervisor, 0, len(p.supervisors))
	for _, sup := range p.supervisors {
		sups = append(sups, sup)
	}
	p.mu.Unlock()

	var wg sync.WaitGroup
	for _, sup := range sups {
		wg.Add(1)
		go func(sup *common.ProcessSupervisor) {
			defer wg.Done()
			_ = sup.Stop()
		}(sup)
	}
	wg.Wait()
}

// parseConfig fills in Provider/Transport/DNS defaults and the recommended
// per-transport tuning block (docs/settings.md "Рекомендуется" rows) when
// the profile didn't set its own.
func (p *Provisioner) parseConfig(profile *models.Profile) (profileCoreConfig, error) {
	var cc profileCoreConfig
	if profile.CoreConfig != "" {
		_ = json.Unmarshal([]byte(profile.CoreConfig), &cc)
	}
	if cc.Provider == "" {
		cc.Provider = "jitsi"
	}
	if cc.Transport == "" {
		cc.Transport = "datachannel"
	}
	if cc.RoomID == "" {
		return cc, fmt.Errorf("olcrtc profile requires a room_id: create the room on the %s provider first, then set it on the profile", cc.Provider)
	}
	if cc.DNS == "" {
		cc.DNS = "1.1.1.1:53"
	}

	switch cc.Transport {
	case "vp8channel":
		if cc.Vp8 == nil {
			cc.Vp8 = &vp8Config{FPS: 30, BatchSize: 64}
		}
	case "seichannel":
		if cc.Sei == nil {
			cc.Sei = &seiConfig{FPS: 30, BatchSize: 64, FragmentSize: 900, AckTimeoutMs: 2000}
		}
	case "videochannel":
		if cc.Video == nil {
			cc.Video = &videoConfig{Codec: "qrcode", Width: 1080, Height: 1080, FPS: 30, QRRecovery: "low"}
		}
	}
	return cc, nil
}

func (p *Provisioner) writeAndStart(profile *models.Profile, cc profileCoreConfig, restart bool) (string, error) {
	encoded, _ := json.Marshal(cc)
	profile.CoreConfig = string(encoded)

	configPath := p.configPath(profile.ExternalID)
	if err := writeYAML(configPath, cc); err != nil {
		return "", err
	}

	sup, exists := p.supervisors[profile.ID]
	if !exists {
		sup = common.NewProcessSupervisor(fmt.Sprintf("olcrtc-%s", profile.ExternalID),
			p.cfg.OlcRTCBinPath, []string{configPath}, p.dataDir)
		p.supervisors[profile.ID] = sup
	}

	var err error
	if restart || exists {
		err = sup.Restart()
	} else {
		err = sup.Start()
	}
	if err != nil {
		return "", fmt.Errorf("start olcrtc for profile %s: %w", profile.ExternalID, err)
	}

	return buildURI(cc, profile.Name), nil
}

func (p *Provisioner) configPath(externalID string) string {
	return filepath.Join(p.dataDir, fmt.Sprintf("profile-%s.yaml", externalID))
}

func writeYAML(path string, cc profileCoreConfig) error {
	var yc yamlConfig
	yc.Mode = "srv"
	yc.Auth.Provider = cc.Provider
	yc.Room.ID = cc.RoomID
	yc.Crypto.Key = cc.CryptoKey
	yc.Net.Transport = cc.Transport
	yc.Net.DNS = cc.DNS

	if cc.Vp8 != nil {
		yc.Vp8 = &vp8YAML{FPS: cc.Vp8.FPS, BatchSize: cc.Vp8.BatchSize}
	}
	if cc.Sei != nil {
		yc.Sei = &seiYAML{
			FPS: cc.Sei.FPS, BatchSize: cc.Sei.BatchSize,
			FragmentSize: cc.Sei.FragmentSize, AckTimeoutMs: cc.Sei.AckTimeoutMs,
		}
	}
	if cc.Video != nil {
		yc.Video = &videoYAML{
			Codec: cc.Video.Codec, Width: cc.Video.Width, Height: cc.Video.Height,
			FPS: cc.Video.FPS, QRRecovery: cc.Video.QRRecovery, QRSize: cc.Video.QRSize,
			TileModule: cc.Video.TileModule, TileRS: cc.Video.TileRS,
		}
	}

	data, err := yaml.Marshal(yc)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}

// buildURI follows the compact convention in docs/uri.md:
// olcrtc://<Provider>?<Transport>@<RoomID>#<EncryptionKey>$<MIMO>
// Transport parameter payloads (vp8/sei/video tuning) are omitted from the
// URI itself — WireTurn's client re-derives its own defaults, and ours are
// only meaningful server-side. See docs/uri.md for the full payload grammar
// if that ever needs to change.
func buildURI(cc profileCoreConfig, name string) string {
	return fmt.Sprintf("olcrtc://%s?%s@%s#%s$%s",
		cc.Provider, cc.Transport, cc.RoomID, cc.CryptoKey, name)
}
