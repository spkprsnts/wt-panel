package xray

import (
	"os"
	"path/filepath"
	"sync"

	"gorm.io/gorm"

	"wtpanel/internal/config"
	"wtpanel/internal/provisioner/common"
)

// Manager owns the single shared xray-core process. Reload rebuilds
// config.json from the DB and starts/restarts/stops the process to match —
// every XrayInbound/XrayClient mutation calls it. No hot add/remove via
// xray-core's Stats/Handler API yet, so a full restart isn't glitch-free for other inbounds' connections.
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

// Reload regenerates config.json from the DB and starts/restarts/stops
// xray-core to match. Safe regardless of current state — no enabled inbounds just means "stopped".
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

// Shutdown stops xray-core gracefully, same "die with the panel" guarantee as the four kernel processes.
func (m *Manager) Shutdown() {
	_ = m.sup.Stop()
}
