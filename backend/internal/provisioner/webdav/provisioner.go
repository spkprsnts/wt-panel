// Package webdav provisions server-side state for the "webdav" kernel:
// https://github.com/spkprsnts/webdav-tunnel
//
// webdav-tunnel's selfhosted mode has no multi-user concept — one process
// is one login/password pair on one port — so, like the other three
// kernels, the panel runs a dedicated process per profile.
package webdav

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"path/filepath"
	"reflect"
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
		dataDir:     filepath.Join(cfg.DataDir, "webdav"),
		supervisors: make(map[uint]*common.ProcessSupervisor),
		runningArgs: make(map[uint][]string),
	}
}

func (p *Provisioner) Type() models.CoreType { return models.CoreWebDAV }

func (p *Provisioner) AddProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.ensureCredentials(profile)
	if err != nil {
		return "", err
	}
	if err := p.ensureProcess(profile, cc); err != nil {
		return "", err
	}
	return p.persistAndBuildURI(profile, cc), nil
}

// UpdateProfile's only logical field is ProxyUpstream — a restart happens
// only if it (or the infra port) actually changed, never on unrelated edits
// like the profile's Name, and never touching any other profile's process.
func (p *Provisioner) UpdateProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.ensureCredentials(profile)
	if err != nil {
		return "", err
	}
	if err := p.ensureProcess(profile, cc); err != nil {
		return "", err
	}
	return p.persistAndBuildURI(profile, cc), nil
}

func (p *Provisioner) Restore(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.parseConfig(profile)
	if err != nil {
		return err
	}
	if cc.Login == "" || cc.Password == "" || cc.Port == 0 {
		return fmt.Errorf("profile %s has no webdav state to restore", profile.ExternalID)
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
	return nil
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

// ensureCredentials fills in login/password/port if this is the first time
// this profile is seen (leaving already-assigned values untouched), and
// defaults ProxyUpstream from the panel-wide setting when the profile
// didn't set its own. Caller must hold p.mu.
func (p *Provisioner) ensureCredentials(profile *models.Profile) (profileCoreConfig, error) {
	cc, err := p.parseConfig(profile)
	if err != nil {
		return cc, err
	}
	if cc.Login == "" {
		cc.Login = "u" + profile.ExternalID[:8]
	}
	if cc.Password == "" {
		pw, err := randomToken(16)
		if err != nil {
			return cc, err
		}
		cc.Password = pw
	}
	if cc.Port == 0 {
		port, err := common.FreePort()
		if err != nil {
			return cc, fmt.Errorf("allocate webdav port: %w", err)
		}
		cc.Port = port
	}
	if cc.ProxyUpstream == "" {
		cc.ProxyUpstream = p.cfg.WebDAVDefaultProxyUpstream
	}
	return cc, nil
}

func (p *Provisioner) parseConfig(profile *models.Profile) (profileCoreConfig, error) {
	var cc profileCoreConfig
	if profile.CoreConfig != "" {
		_ = json.Unmarshal([]byte(profile.CoreConfig), &cc)
	}
	return cc, nil
}

// ensureProcess (re)starts this profile's process only if it isn't running
// yet or its infra-relevant flags (port, login/password, proxy upstream)
// actually changed.
func (p *Provisioner) ensureProcess(profile *models.Profile, cc profileCoreConfig) error {
	args := []string{
		"-mode", "selfhosted",
		"-webdav-listen", fmt.Sprintf("%s:%d", p.cfg.WebDAVListenHost, cc.Port),
		"-webdav-storage", filepath.Join(p.dataDir, profile.ExternalID),
		"-login", cc.Login,
		"-password", cc.Password,
	}
	if cc.ProxyUpstream != "" {
		args = append(args, "-proxy", cc.ProxyUpstream)
	}

	sup, exists := p.supervisors[profile.ID]
	if exists && reflect.DeepEqual(p.runningArgs[profile.ID], args) {
		return nil // nothing infra-relevant changed, leave the process alone
	}
	if !exists {
		sup = common.NewProcessSupervisor(fmt.Sprintf("webdav-%s", profile.ExternalID),
			p.cfg.WebDAVBinPath, args, p.dataDir)
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
		return fmt.Errorf("start webdav-tunnel for profile %s: %w", profile.ExternalID, err)
	}
	p.runningArgs[profile.ID] = args
	return nil
}

func (p *Provisioner) persistAndBuildURI(profile *models.Profile, cc profileCoreConfig) string {
	encoded, _ := json.Marshal(cc)
	profile.CoreConfig = string(encoded)
	return buildURI(p.cfg, cc, profile.Name)
}

// buildURI follows webdav(s)://[login[:password]@]host[:port][/path]?...#name
// from docs/subscriptions.md §2.3.
func buildURI(cfg *config.Config, cc profileCoreConfig, name string) string {
	scheme := cfg.WebDAVPublicScheme
	if scheme == "" {
		scheme = "webdav"
	}
	return fmt.Sprintf("%s://%s:%s@%s:%d?timeout=60s&poll-min=200ms&poll-max=500ms#%s",
		scheme, cc.Login, cc.Password, cfg.WebDAVPublicHost, cc.Port, name)
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
