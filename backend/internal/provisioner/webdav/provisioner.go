// Package webdav provisions server-side state for the "webdav" kernel:
// https://github.com/spkprsnts/webdav-tunnel
//
// selfhosted mode has no multi-user concept (one login/password per port),
// so like the other three kernels the panel runs a dedicated process per
// profile. Server mode is different: no local listener, just a relay to existing external backends — see profileCoreConfig.
package webdav

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
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
	runningArgs map[uint][]string                  // last (args, extra change-detection state) a profile's process was (re)started with
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

	cc, err := p.applyDefaults(profile)
	if err != nil {
		return "", err
	}
	if err := p.ensureProcess(profile, cc); err != nil {
		return "", err
	}
	return p.persistAndBuildURI(profile, cc)
}

// UpdateProfile restarts only if something infra-relevant changed
// (selfhosted: port/login/password/proxy/enc/tls/dns; server: the config file's content) — never on unrelated edits like Name.
func (p *Provisioner) UpdateProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.applyDefaults(profile)
	if err != nil {
		return "", err
	}
	if err := p.ensureProcess(profile, cc); err != nil {
		return "", err
	}
	return p.persistAndBuildURI(profile, cc)
}

func (p *Provisioner) Restore(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.parseConfig(profile)
	if err != nil {
		return err
	}
	incomplete := cc.ConnMode == "server" && len(cc.Backends) == 0
	incomplete = incomplete || (cc.ConnMode != "server" && (cc.Login == "" || cc.Password == "" || cc.Port == 0))
	if incomplete {
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

// applyDefaults fills in whatever this profile is missing. Server-mode just
// checks at least one backend was given; selfhosted auto-generates
// login/password/port/proxy. Caller must hold p.mu.
func (p *Provisioner) applyDefaults(profile *models.Profile) (profileCoreConfig, error) {
	cc, err := p.parseConfig(profile)
	if err != nil {
		return cc, err
	}
	if cc.ConnMode == "" {
		cc.ConnMode = "selfhosted"
	}

	if cc.ConnMode == "server" {
		if len(cc.Backends) == 0 {
			return cc, fmt.Errorf("webdav server profile requires at least one backend (url/login/password of an existing WebDAV endpoint)")
		}
		return cc, nil
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

// ensureProcess (re)starts the process only if it isn't running or something
// infra-relevant changed. Server mode's config lives in a YAML file, not CLI
// flags, so changeKey carries the raw YAML bytes alongside args to still catch those edits.
func (p *Provisioner) ensureProcess(profile *models.Profile, cc profileCoreConfig) error {
	var args []string
	changeKey := []string{cc.ConnMode}

	if cc.ConnMode == "server" {
		configPath := p.serverConfigPath(profile.ExternalID)
		yamlBytes, err := buildServerConfigYAML(cc)
		if err != nil {
			return fmt.Errorf("build webdav server config for profile %s: %w", profile.ExternalID, err)
		}
		if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(configPath, yamlBytes, 0o600); err != nil {
			return err
		}
		args = []string{"-config", configPath}
		changeKey = append(changeKey, string(yamlBytes))
	} else {
		args = []string{
			"-mode", "selfhosted",
			"-webdav-listen", fmt.Sprintf("%s:%d", p.cfg.WebDAVListenHost, cc.Port),
			"-webdav-storage", filepath.Join(p.dataDir, profile.ExternalID),
			"-login", cc.Login,
			"-password", cc.Password,
		}
		if cc.ProxyUpstream != "" {
			args = append(args, "-proxy", cc.ProxyUpstream)
		}
		if cc.Enc {
			args = append(args, "-enc")
		}
		if cc.TLSCertFile != "" && cc.TLSKeyFile != "" {
			args = append(args, "-webdav-tls-cert", cc.TLSCertFile, "-webdav-tls-key", cc.TLSKeyFile)
		}
		if cc.Dns != "" {
			args = append(args, "-dns", cc.Dns)
		}
		args = append(args, tuningFlags(cc)...)
		changeKey = append(changeKey, args...)
	}

	sup, exists := p.supervisors[profile.ID]
	if exists && reflect.DeepEqual(p.runningArgs[profile.ID], changeKey) {
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
	p.runningArgs[profile.ID] = changeKey
	return nil
}

func (p *Provisioner) serverConfigPath(externalID string) string {
	return filepath.Join(p.dataDir, externalID, "config.yaml")
}

// serverYAMLConfig mirrors the subset of webdav-tunnel's -config schema this
// provisioner drives — mode/enc/dns/proxy live in the file too, so there's one source of truth for a server-mode profile.
type serverYAMLConfig struct {
	Mode     string          `yaml:"mode"`
	Enc      bool            `yaml:"enc,omitempty"`
	Dns      string          `yaml:"dns,omitempty"`
	Proxy    string          `yaml:"proxy,omitempty"`
	Backends []WebdavBackend `yaml:"backends"`
	Tuning   *yamlTuning     `yaml:"tuning,omitempty"`
}

// yamlTuning is docs/config.md's "tuning:" block — written only when the
// operator overrode at least one field (see hasTuningOverride); otherwise omitted so webdav-tunnel applies its own generic defaults.
type yamlTuning struct {
	PollMin   string `yaml:"poll-min,omitempty"`
	PollMax   string `yaml:"poll-max,omitempty"`
	Coalesce  string `yaml:"coalesce,omitempty"`
	ChunkSize int    `yaml:"chunk-size,omitempty"`
	Puts      int    `yaml:"puts,omitempty"`
	ReadMin   int    `yaml:"read-min,omitempty"`
	ReadMax   int    `yaml:"read-max,omitempty"`
}

func hasTuningOverride(cc profileCoreConfig) bool {
	return cc.PollMin != "" || cc.PollMax != "" || cc.Coalesce != "" ||
		cc.ChunkSize != 0 || cc.Puts != 0 || cc.ReadMin != 0 || cc.ReadMax != 0
}

func buildServerConfigYAML(cc profileCoreConfig) ([]byte, error) {
	y := serverYAMLConfig{
		Mode:     "server",
		Enc:      cc.Enc,
		Dns:      cc.Dns,
		Proxy:    cc.ProxyUpstream,
		Backends: cc.Backends,
	}
	if hasTuningOverride(cc) {
		y.Tuning = &yamlTuning{
			PollMin: cc.PollMin, PollMax: cc.PollMax, Coalesce: cc.Coalesce,
			ChunkSize: cc.ChunkSize, Puts: cc.Puts, ReadMin: cc.ReadMin, ReadMax: cc.ReadMax,
		}
	}
	return yaml.Marshal(y)
}

// tuningFlags renders the operator's overrides as -poll-min/etc CLI flags
// for selfhosted mode. Zero-valued fields are omitted so webdav-tunnel's own defaults apply.
func tuningFlags(cc profileCoreConfig) []string {
	var args []string
	if cc.PollMin != "" {
		args = append(args, "-poll-min", cc.PollMin)
	}
	if cc.PollMax != "" {
		args = append(args, "-poll-max", cc.PollMax)
	}
	if cc.Coalesce != "" {
		args = append(args, "-coalesce", cc.Coalesce)
	}
	if cc.ChunkSize != 0 {
		args = append(args, "-chunk-size", strconv.Itoa(cc.ChunkSize))
	}
	if cc.Puts != 0 {
		args = append(args, "-puts", strconv.Itoa(cc.Puts))
	}
	if cc.ReadMin != 0 {
		args = append(args, "-read-min", strconv.Itoa(cc.ReadMin))
	}
	if cc.ReadMax != 0 {
		args = append(args, "-read-max", strconv.Itoa(cc.ReadMax))
	}
	return args
}

func (p *Provisioner) persistAndBuildURI(profile *models.Profile, cc profileCoreConfig) (string, error) {
	encoded, _ := json.Marshal(cc)
	profile.CoreConfig = string(encoded)
	return buildURI(p.cfg, cc, profile.Name)
}

// buildURI follows webdav(s)://[login[:password]@]host[:port][/path]?...#name
// (docs/subscriptions.md §2.3). Selfhosted and server mode differ enough to need their own builder each.
func buildURI(cfg *config.Config, cc profileCoreConfig, name string) (string, error) {
	if cc.ConnMode == "server" {
		return buildServerURI(cc, name)
	}
	return buildSelfhostedURI(cfg, cc, name), nil
}

// resolvedTuningQuery reports what the server ACTUALLY runs with — override
// where given, else the correct auto-default for this mode (selfhosted gets
// a faster poll-min/poll-max/coalesce preset). Must match the server exactly, since the client URI is the only place these values reach the client.
func resolvedTuningQuery(cc profileCoreConfig) url.Values {
	pollMin, pollMax, coalesce := "200ms", "500ms", "10ms"
	if cc.ConnMode != "server" {
		pollMin, pollMax, coalesce = "50ms", "200ms", "5ms"
	}
	if cc.PollMin != "" {
		pollMin = cc.PollMin
	}
	if cc.PollMax != "" {
		pollMax = cc.PollMax
	}
	if cc.Coalesce != "" {
		coalesce = cc.Coalesce
	}
	chunkSize, puts, readMin, readMax := 131071, 8, 3, 8
	if cc.ChunkSize != 0 {
		chunkSize = cc.ChunkSize
	}
	if cc.Puts != 0 {
		puts = cc.Puts
	}
	if cc.ReadMin != 0 {
		readMin = cc.ReadMin
	}
	if cc.ReadMax != 0 {
		readMax = cc.ReadMax
	}
	return url.Values{
		"poll-min":   {pollMin},
		"poll-max":   {pollMax},
		"coalesce":   {coalesce},
		"chunk-size": {strconv.Itoa(chunkSize)},
		"puts":       {strconv.Itoa(puts)},
		"read-min":   {strconv.Itoa(readMin)},
		"read-max":   {strconv.Itoa(readMax)},
	}
}

// buildSelfhostedURI matches webdav-tunnel's own selfhostedClientURI: scheme
// reflects THIS profile's own TLS cert/key, no panel-wide default or reverse-proxy termination.
func buildSelfhostedURI(cfg *config.Config, cc profileCoreConfig, name string) string {
	scheme := "webdav"
	if cc.TLSCertFile != "" && cc.TLSKeyFile != "" {
		scheme = "webdavs"
	}
	q := resolvedTuningQuery(cc)
	q.Set("timeout", "60s")
	if cc.Enc {
		q.Set("enc", "1")
	}
	if cc.Dns != "" {
		q.Set("dns", cc.Dns)
	}
	u := &url.URL{
		Scheme:   scheme,
		User:     url.UserPassword(cc.Login, cc.Password),
		Host:     fmt.Sprintf("%s:%d", cfg.ResolvedWebDAVPublicHost(), cc.Port),
		RawQuery: q.Encode(),
		Fragment: name,
	}
	return u.String()
}

// buildServerURI packs the primary backend into the URI's userinfo/host and
// additional ones as repeated "backend=" nested URIs — matches webdav-tunnel's own tunnel.ClientURI format.
func buildServerURI(cc profileCoreConfig, name string) (string, error) {
	if len(cc.Backends) == 0 {
		return "", fmt.Errorf("webdav server profile has no backends configured")
	}
	primary := cc.Backends[0]
	u, err := url.Parse(primary.URL)
	if err != nil {
		return "", fmt.Errorf("parse backend url %q: %w", primary.URL, err)
	}
	switch u.Scheme {
	case "http":
		u.Scheme = "webdav"
	case "https":
		u.Scheme = "webdavs"
	}
	u.User = url.UserPassword(primary.Login, primary.Password)

	q := resolvedTuningQuery(cc)
	if cc.Enc {
		q.Set("enc", "1")
	}
	if cc.Dns != "" {
		q.Set("dns", cc.Dns)
	}
	for _, b := range cc.Backends[1:] {
		nested, err := url.Parse(b.URL)
		if err != nil {
			continue // a malformed extra backend shouldn't break the whole URI
		}
		switch nested.Scheme {
		case "http":
			nested.Scheme = "webdav"
		case "https":
			nested.Scheme = "webdavs"
		}
		nested.User = url.UserPassword(b.Login, b.Password)
		q.Add("backend", nested.String())
	}
	u.RawQuery = q.Encode()
	u.Fragment = name
	return u.String(), nil
}

func randomToken(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
