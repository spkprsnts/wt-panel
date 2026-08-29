// Package turnable provisions server-side state for the "turnable" kernel:
// https://github.com/TheAirBlow/Turnable
//
// Upstream has no built-in user database or hot-reload, so rather than
// share one server process across every profile — forcing a restart,
// dropping every other user's connection, on any single profile edit —
// this provisioner runs one dedicated Turnable server process per profile,
// each with its own listen port, call_id, key material and a single
// embedded user.
package turnable

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	"wtpanel/internal/config"
	"wtpanel/internal/models"
	"wtpanel/internal/provisioner/common"
)

// routeID is the fixed id/display name of the single route embedded in
// every profile's config — there's exactly one egress destination per
// profile, so there's nothing for the operator to name.
const routeID = "main"

type Provisioner struct {
	cfg     *config.Config
	dataDir string

	mu          sync.Mutex
	supervisors map[uint]*common.ProcessSupervisor // keyed by profile ID
}

func New(cfg *config.Config) *Provisioner {
	return &Provisioner{
		cfg:         cfg,
		dataDir:     filepath.Join(cfg.DataDir, "turnable"),
		supervisors: make(map[uint]*common.ProcessSupervisor),
	}
}

func (p *Provisioner) Type() models.CoreType { return models.CoreTurnable }

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
			return "", fmt.Errorf("allocate turnable port: %w", err)
		}
		cc.Port = port
	}

	if cc.PubKey == "" || cc.PrivKey == "" {
		pub, priv, err := Keygen(ctx, p.cfg.TurnableBinPath)
		if err != nil {
			return "", err
		}
		cc.PubKey, cc.PrivKey = pub, priv
	}

	return p.writeAndStart(profile, cc, false)
}

func (p *Provisioner) UpdateProfile(ctx context.Context, profile *models.Profile) (string, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	cc, err := p.applyLogicalDefaults(profile)
	if err != nil {
		return "", err
	}
	if cc.Port == 0 {
		// No prior port on record (shouldn't normally happen) — treat as
		// a fresh provision rather than silently picking a random one.
		port, err := common.FreePort()
		if err != nil {
			return "", fmt.Errorf("allocate turnable port: %w", err)
		}
		cc.Port = port
	}
	if cc.PubKey == "" || cc.PrivKey == "" {
		pub, priv, err := Keygen(ctx, p.cfg.TurnableBinPath)
		if err != nil {
			return "", err
		}
		cc.PubKey, cc.PrivKey = pub, priv
	}

	return p.writeAndStart(profile, cc, true)
}

func (p *Provisioner) Restore(ctx context.Context, profile *models.Profile) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	var cc profileCoreConfig
	if profile.CoreConfig != "" {
		_ = json.Unmarshal([]byte(profile.CoreConfig), &cc)
	}
	if cc.CallID == "" || cc.Port == 0 || cc.PubKey == "" || cc.PrivKey == "" {
		return fmt.Errorf("profile %s has no turnable state to restore", profile.ExternalID)
	}
	_, err := p.writeAndStart(profile, cc, false)
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

// applyLogicalDefaults parses profile.CoreConfig and fills defaults for
// everything that has one. CallID and RoutePort have no default — CallID
// must name a call/room the operator already created on the platform, and
// RoutePort depends entirely on which local service this profile should
// reach.
func (p *Provisioner) applyLogicalDefaults(profile *models.Profile) (profileCoreConfig, error) {
	var cc profileCoreConfig
	if profile.CoreConfig != "" {
		_ = json.Unmarshal([]byte(profile.CoreConfig), &cc)
	}
	if cc.CallID == "" {
		return cc, fmt.Errorf("turnable profile requires call_id: create a dedicated call/room on the platform first, then set it on the profile")
	}
	if cc.RoutePort == 0 {
		return cc, fmt.Errorf("turnable profile requires route_port: which local port should this profile's traffic reach (e.g. your WireGuard or VLESS port)?")
	}
	if cc.ConnectionType == "" {
		cc.ConnectionType = "relay"
	}
	if cc.Proto == "" {
		cc.Proto = "srtp"
	}
	if cc.Encryption == "" {
		cc.Encryption = "handshake"
	}
	if cc.Peers <= 0 {
		cc.Peers = 10
	}
	if cc.PlatformID == "" {
		// Not env-configurable — profile-form.tsx's platform select only
		// ever offers "vk.com" and always sends it explicitly, so this only
		// matters for a profile created by calling the API directly.
		cc.PlatformID = "vk.com"
	}
	if cc.RouteAddr == "" {
		cc.RouteAddr = p.cfg.TurnableDefaultRouteHost
	}
	if cc.RouteSocket == "" {
		// Same reasoning as PlatformID above — the form's own initial state
		// always sends "udp" explicitly.
		cc.RouteSocket = "udp"
	}
	if cc.RouteTransport == "" {
		cc.RouteTransport = transportFor(cc.RouteSocket)
	}
	return cc, nil
}

func (p *Provisioner) writeAndStart(profile *models.Profile, cc profileCoreConfig, restart bool) (string, error) {
	encoded, _ := json.Marshal(cc)
	profile.CoreConfig = string(encoded)

	configPath := p.configPath(profile.ExternalID)
	sf := serverFile{
		Servers: map[string]serverEntry{
			"main": {
				Type:       "relay", // the only value Turnable's server itself supports
				PlatformID: cc.PlatformID,
				CallID:     cc.CallID,
				PubKey:     cc.PubKey,
				PrivKey:    cc.PrivKey,
				Proto:      cc.Proto,
				ListenAddr: fmt.Sprintf("%s:%d", p.cfg.TurnableListenHost, cc.Port),
				PublicIP:   p.cfg.PublicIP,
				Cloak:      "none",
				Provider:   "provider_main",
			},
		},
		Providers: map[string]providerEntry{
			"provider_main": {
				Type: "raw",
				Routes: []route{{
					ID:         routeID,
					Address:    cc.RouteAddr,
					Port:       cc.RoutePort,
					Socket:     cc.RouteSocket,
					Transport:  cc.RouteTransport,
					Encryption: cc.Encryption,
					Name:       routeID,
				}},
				Users: []user{{
					UUID:          profile.ExternalID,
					AllowedRoutes: []string{routeID},
					Type:          "relay",
					Peers:         cc.Peers,
				}},
			},
		},
	}
	data, err := json.MarshalIndent(sf, "", "  ")
	if err != nil {
		return "", err
	}
	if err := os.WriteFile(configPath, data, 0o600); err != nil {
		return "", err
	}

	sup, exists := p.supervisors[profile.ID]
	if !exists {
		sup = common.NewProcessSupervisor(fmt.Sprintf("turnable-%s", profile.ExternalID),
			p.cfg.TurnableBinPath, []string{"server", "-c", configPath}, p.dataDir)
		p.supervisors[profile.ID] = sup
	}

	var startErr error
	if restart || exists {
		startErr = sup.Restart()
	} else {
		startErr = sup.Start()
	}
	if startErr != nil {
		return "", fmt.Errorf("start turnable for profile %s: %w", profile.ExternalID, startErr)
	}

	return buildURI(p.cfg, profile, cc), nil
}

func (p *Provisioner) configPath(externalID string) string {
	return filepath.Join(p.dataDir, fmt.Sprintf("profile-%s.json", externalID))
}

// buildURI follows docs/subscriptions.md §2.1:
// turnable://[user_uuid]:[call_id]@[platform_id]/[route_id-socket-transport]?type=...&gateway=host:port&proto=...&cloak=none&peers=...&encryption=...&pub_key=...&selected_route_id=...#name
//
// The route's socket/transport used to only reach the SERVER's local
// config.json — the path segment was just the bare route id ("main"), so
// the client had no way to know this route needs tcp+kcp rather than plain
// udp. Per the spec's worked example, the transport half is the empty
// string when the socket is udp, not the literal "none" — RouteTransport
// only ever holds "none" as this provisioner's internal placeholder (see
// profileCoreConfig), so it's translated back to "" before hitting the URI.
//
// `type` is the client-facing connection mode (relay/direct), independent
// from the server config's own "type" field which is always "relay".
// `pub_key` is the server's ML-KEM-768 public key (see Keygen) the client
// needs to perform that handshake against — omitting it (an earlier
// version did) leaves the client with no key to encrypt to. It's base64
// (+/=-bearing), so it has to be query-escaped, unlike every other segment
// here.
func buildURI(cfg *config.Config, profile *models.Profile, cc profileCoreConfig) string {
	gateway := fmt.Sprintf("%s:%d", cfg.PublicIP, cc.Port)
	routeTransport := cc.RouteTransport
	if routeTransport == "none" {
		routeTransport = ""
	}
	route := fmt.Sprintf("%s-%s-%s", routeID, cc.RouteSocket, routeTransport)
	return fmt.Sprintf("turnable://%s:%s@%s/%s?type=%s&gateway=%s&proto=%s&cloak=none&peers=%d&encryption=%s&pub_key=%s&selected_route_id=%s#%s",
		profile.ExternalID, cc.CallID, cc.PlatformID,
		route, cc.ConnectionType, gateway, cc.Proto, cc.Peers, cc.Encryption, url.QueryEscape(cc.PubKey), routeID, profile.Name)
}

// transportFor is only used to seed a sensible default: TCP routes should
// use kcp, UDP should use none (docs/server/CONFIG.md upstream) — but the
// field stays fully overridable per profile.
func transportFor(socket string) string {
	if socket == "udp" {
		return "none"
	}
	return "kcp"
}
