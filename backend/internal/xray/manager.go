package xray

import (
	"os"
	"path/filepath"
	"sync"

	"gorm.io/gorm"

	"wtpanel/internal/config"
	"wtpanel/internal/provisioner/common"
)

// Manager owns the single shared xray-core process. Reload is the only
// entry point that matters operationally: it rebuilds config.json from the
// database and starts/restarts/stops the process to match. Every mutation
// to an XrayInbound or XrayClient calls Reload afterwards — there's no hot
// add/remove via xray-core's Stats/Handler API yet (see README), so a full
// restart is simple and correct, just not glitch-free for other inbounds'
// connections while it happens.
type Manager struct {
	mu         sync.Mutex
	db         *gorm.DB
	configPath string
	sup        *common.ProcessSupervisor
}

func NewManager(cfg *config.Config, db *gorm.DB) *Manager {
	dataDir := filepath.Join(cfg.DataDir, "xray")
	_ = os.MkdirAll(dataDir, 0o755)
	configPath := filepath.Join(dataDir, "config.json")

	return &Manager{
		db:         db,
		configPath: configPath,
		sup:        common.NewProcessSupervisor("xray-core", cfg.XrayBinPath, []string{"run", "-c", configPath}, dataDir),
	}
}

// Reload regenerates config.json from the current DB state and starts,
// restarts, or stops xray-core so the running process matches it. Safe to
// call whether or not xray-core is currently running, and whether or not
// any inbound is even enabled (an empty config just means "stopped").
func (m *Manager) Reload() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	data, count, err := BuildConfig(m.db)
	if err != nil {
		return err
	}

	if count == 0 {
		if m.sup.IsRunning() {
			return m.sup.Stop()
		}
		return nil
	}

	if err := os.WriteFile(m.configPath, data, 0o600); err != nil {
		return err
	}

	if m.sup.IsRunning() {
		return m.sup.Restart()
	}
	return m.sup.Start()
}

// Status reports whether xray-core is currently running and its PID (0 if
// not running) — mirrors the four kernel provisioners' Status contract.
func (m *Manager) Status() (running bool, pid int) {
	return m.sup.IsRunning(), m.sup.PID()
}

func (m *Manager) Logs(maxBytes int) (string, error) {
	return m.sup.ReadLog(maxBytes)
}

// Shutdown stops xray-core gracefully — called alongside
// registry.ShutdownAll(), same "die with the panel" guarantee the four
// kernel processes already have.
func (m *Manager) Shutdown() {
	_ = m.sup.Stop()
}
