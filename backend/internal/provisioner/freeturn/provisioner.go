// Package freeturn provisions server-side state for the "freeturn" kernel:
// https://github.com/samosvalishe/free-turn-proxy
//
// Each profile gets its own dedicated process and port, so editing or
// removing one never restarts another's. No client-id allowlisting (clients.json) — see profileCoreConfig.
package freeturn

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"

	"wtpanel/internal/config"
	"wtpanel/internal/models"
	"wtpanel/internal/provisioner/common"
)

type Provisioner struct {
	cfg     *config.Config
	dataDir string

	mu          sync.Mutex
	supervisors map[uint]*common.ProcessSupervisor // keyed by profile ID
	runningArgs map[uint][]string                  // last args a profile's process was (re)started with
}

func New(cfg *config.Config) *Provisioner {
	return &Provisioner{
		cfg:         cfg,
		dataDir:     filepath.Join(cfg.DataDir, "freeturn"),
		supervisors: make(map[uint]*common.ProcessSupervisor),
		runningArgs: make(map[uint][]string),
	}
}

func (p *Provisioner) Type() models.CoreType { return models.CoreFreeTurn }

func (p *Provisioner) AddProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.applyLogicalDefaults(profile)
	if err != nil {
		return "", err
	}

	if cc.Port == 0 {
		port, err := common.FreePort()
		if err != nil {
			return "", fmt.Errorf("allocate freeturn port: %w", err)
		}
		cc.Port = port
	}

	if cc.ObfProfile != "none" && cc.ObfKey == "" {
		key, err := common.RandomHexKey(32)
		if err != nil {
			return "", fmt.Errorf("generate freeturn obf-key: %w", err)
		}
		cc.ObfKey = key
	}

	if err := p.ensureProcess(profile, cc); err != nil {
		return "", err
	}
	return p.persistAndBuildURI(profile, cc), nil
}

func (p *Provisioner) UpdateProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.applyLogicalDefaults(profile)
	if err != nil {
		return "", err
	}

	if cc.Port == 0 {
		// No prior port on record — treat as a fresh provision.
		port, err := common.FreePort()
		if err != nil {
			return "", fmt.Errorf("allocate freeturn port: %w", err)
		}
		cc.Port = port
	}
	if cc.ObfProfile != "none" && cc.ObfKey == "" {
		key, err := common.RandomHexKey(32)
		if err != nil {
			return "", fmt.Errorf("generate freeturn obf-key: %w", err)
		}
		cc.ObfKey = key
	}

	if err := p.ensureProcess(profile, cc); err != nil {
		return "", err
	}
	// Provider/Links/Transport only affect the client-facing URI, never
	// process flags — ensureProcess restarts only if something infra-relevant (port/connect/obf-*) changed.
	return p.persistAndBuildURI(profile, cc), nil
}

func (p *Provisioner) Restore(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	var cc profileCoreConfig
	if profile.CoreConfig != "" {
		_ = json.Unmarshal([]byte(profile.CoreConfig), &cc)
	}
	if cc.Port == 0 {
		return fmt.Errorf("profile %s has no freeturn state to restore", profile.ExternalID)
	}
	return p.ensureProcess(profile, cc)
}

func (p *Provisioner) RemoveProfile(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	if sup, ok := p.supervisors[profile.ID]; ok {
		_ = sup.Stop()
		delete(p.supervisors, profile.ID)
		delete(p.runningArgs, profile.ID)
	}
	return os.RemoveAll(p.profileDir(profile.ExternalID))
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

func (p *Provisioner) Stop(profile *models.Profile) error {
	p.mu.Lock()
	sup, ok := p.supervisors[profile.ID]
	p.mu.Unlock()
	if !ok {
		return nil
	}
	return sup.Stop()
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

// applyLogicalDefaults parses profile.CoreConfig and fills in Provider/
// Transport/ConnectHost/ObfProfile from panel-wide defaults where the
// profile didn't set them itself. ConnectPort has no default (depends on
// which local service this profile should reach).
func (p *Provisioner) applyLogicalDefaults(profile *models.Profile) (profileCoreConfig, error) {
	var cc profileCoreConfig
	if profile.CoreConfig != "" {
		_ = json.Unmarshal([]byte(profile.CoreConfig), &cc)
	}
	if cc.Provider == "" {
		cc.Provider = "vk"
	}
	if cc.Transport == "" {
		cc.Transport = "tcp"
	}
	if cc.Mode == "" {
		cc.Mode = "udp"
	}
	if cc.ConnectHost == "" {
		cc.ConnectHost = p.cfg.FreeTurnDefaultConnectHost
	}
	if cc.ConnectPort == 0 {
		return cc, fmt.Errorf("freeturn profile requires connect_port: which local port should this profile's traffic reach (e.g. your WireGuard port)?")
	}
	if cc.ObfProfile == "" {
		cc.ObfProfile = "rtpopus"
	}
	return cc, nil
}

// ensureProcess (re)starts the process only if it isn't running yet or its
// infra-relevant flags changed — editing Provider/Links/Transport never restarts it.
func (p *Provisioner) ensureProcess(profile *models.Profile, cc profileCoreConfig) error {
	dir := p.profileDir(profile.ExternalID)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	args := []string{
		"-listen", fmt.Sprintf("%s:%d", p.cfg.FreeTurnListenHost, cc.Port),
		"-connect", fmt.Sprintf("%s:%d", cc.ConnectHost, cc.ConnectPort),
		"-mode", cc.Mode,
		"-obf-profile", cc.ObfProfile,
	}
	if cc.ObfProfile != "none" && cc.ObfKey != "" {
		args = append(args, "-obf-key", cc.ObfKey)
	}
	if cc.ObfProfile != "none" && cc.ObfTiming != "" {
		args = append(args, "-obf-timing", cc.ObfTiming)
	}
	// upstream rejects -kcp-* flags outright in -mode udp, so only pass
	// them alongside -mode tcp.
	if cc.Mode == "tcp" && cc.KCP != nil {
		k := cc.KCP
		args = append(args,
			"-kcp-nodelay", strconv.Itoa(k.NoDelay),
			"-kcp-interval", strconv.Itoa(k.Interval),
			"-kcp-resend", strconv.Itoa(k.Resend),
			"-kcp-nc", strconv.Itoa(k.NC),
			"-kcp-sndwnd", strconv.Itoa(k.SndWnd),
			"-kcp-rcvwnd", strconv.Itoa(k.RcvWnd),
			"-kcp-mtu", strconv.Itoa(k.MTU),
			"-kcp-acknodelay="+strconv.FormatBool(k.ACKNoDelay),
		)
	}

	sup, exists := p.supervisors[profile.ID]
	if exists && reflect.DeepEqual(p.runningArgs[profile.ID], args) {
		return nil // nothing infra-relevant changed, leave the process alone
	}
	if !exists {
		sup = common.NewProcessSupervisor(fmt.Sprintf("freeturn-%s", profile.ExternalID),
			p.cfg.FreeTurnBinPath, args, dir)
		p.supervisors[profile.ID] = sup
	} else {
		sup.SetArgs(args)
	}

	var err error
	if exists {
		err = sup.Restart()
	} else {
		err = sup.Start()
	}
	if err != nil {
		return fmt.Errorf("start freeturn for profile %s: %w", profile.ExternalID, err)
	}
	p.runningArgs[profile.ID] = args
	return nil
}

func (p *Provisioner) persistAndBuildURI(profile *models.Profile, cc profileCoreConfig) string {
	encoded, _ := json.Marshal(cc)
	profile.CoreConfig = string(encoded)
	return buildURI(p.cfg, cc)
}

func (p *Provisioner) profileDir(externalID string) string {
	return filepath.Join(p.dataDir, externalID)
}

func buildURI(cfg *config.Config, cc profileCoreConfig) string {
	payload := freeturnURI{
		V:        1,
		Provider: cc.Provider,
		Peer:     fmt.Sprintf("%s:%d", cfg.PublicIP, cc.Port),
		Links:    strings.Join(cc.Links, ","),
	}
	if cc.Transport != "" && cc.Transport != "tcp" {
		payload.Transport = cc.Transport
	}
	if cc.Mode != "" && cc.Mode != "udp" {
		payload.Mode = cc.Mode
	}
	if cc.Mode == "tcp" && cc.KCP != nil {
		payload.KCP = cc.KCP
	}
	if cc.ObfProfile != "" && cc.ObfProfile != "none" {
		payload.Obf = cc.ObfProfile
		payload.Key = cc.ObfKey
		payload.Obft = cc.ObfTiming
	}
	data, _ := json.Marshal(payload)
	return "freeturn://" + base64.RawURLEncoding.EncodeToString(data)
}
