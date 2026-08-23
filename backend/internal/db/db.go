package db

import (
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"wtpanel/internal/models"
)

func Open(path string) (*gorm.DB, error) {
	// GORM's default logger treats ErrRecordNotFound as an error-level log
	// line even though callers like recordKernelInstall (handlers_kernels.go)
	// use "not found" as an expected, handled branch (create-if-missing) —
	// IgnoreRecordNotFoundError silences that specific noise without
	// hiding real errors.
	gormLogger := logger.New(log.New(os.Stderr, "", log.LstdFlags), logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  logger.Warn,
		IgnoreRecordNotFoundError: true,
	})

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormLogger})
	if err != nil {
		return nil, err
	}

	// SQLite has no real concurrent-writer story, and database/sql's default
	// pool will happily open more than one connection to this same file.
	// Pinning it to one connection serializes every query through it —
	// the standard defensive default for Go+SQLite — and costs nothing
	// here, since this panel was never going to benefit from concurrent
	// connections against one local file anyway. (This was the first fix
	// tried for a real xray-core startup failure that looked exactly like
	// a stale read — it turned out not to be the actual cause there, see
	// handlers_xray.go's generateClientIdentity, but it's a legitimate
	// footgun to close regardless.)
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}

	if err := db.AutoMigrate(
		&models.AdminUser{},
		&models.Client{},
		&models.Profile{},
		&models.SubscriptionToken{},
		&models.KernelInstall{},
		&models.CallRoom{},
		&models.XrayInbound{},
		&models.XrayClient{},
		&models.PanelSettings{},
	); err != nil {
		return nil, err
	}

	if err := seedAdmin(db); err != nil {
		return nil, err
	}
	if err := seedPanelSettings(db); err != nil {
		return nil, err
	}

	return db, nil
}

// seedPanelSettings creates the singleton PanelSettings row (id 1) on
// first run, so main.go and the Settings page can always assume row 1
// exists rather than special-casing "not created yet". WTP_INITIAL_BASE_PATH
// lets the installer seed a random URI path instead of "/" — same
// first-run-only semantics as seedAdmin's WTP_ADMIN_PASSWORD above.
func seedPanelSettings(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.PanelSettings{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	basePath := os.Getenv("WTP_INITIAL_BASE_PATH")
	if basePath == "" {
		basePath = "/"
	}

	// Same "seed once, editable afterward" shape as basePath above: an
	// explicit WTP_PUBLIC_IP wins if set (e.g. install.sh already knows
	// it), otherwise best-effort auto-detect so the field isn't blank by
	// default — a blank public_ip is exactly what makes Turnable refuse to
	// start ("public_ip is required"). Detection failing (no egress, IPv6-
	// only, etc.) just leaves it empty for the operator to fill in
	// themselves on the Settings page; it's never fatal to startup.
	publicIP := os.Getenv("WTP_PUBLIC_IP")
	if publicIP == "" {
		publicIP = detectPublicIP()
	}
	return db.Create(&models.PanelSettings{BasePath: basePath, PublicIP: publicIP}).Error
}

// detectPublicIP asks a couple of plain-text "what's my IP" endpoints,
// first one to answer with something that parses as an IP wins. Not
// GitHub/any single provider's API — this is a different, much more
// tolerant kind of external dependency (no auth, no rate limit that
// matters for one lookup at first boot), but still only ever used to
// pre-fill a field the operator can freely overwrite, so failure here is
// silently swallowed rather than surfaced anywhere.
func detectPublicIP() string {
	client := &http.Client{Timeout: 3 * time.Second}
	for _, url := range []string{"https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"} {
		resp, err := client.Get(url)
		if err != nil {
			continue
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 128))
		resp.Body.Close()
		if err != nil {
			continue
		}
		ip := strings.TrimSpace(string(body))
		if net.ParseIP(ip) != nil {
			return ip
		}
	}
	return ""
}

// seedAdmin creates the initial admin account on first run so the panel is
// usable immediately. WTP_ADMIN_PASSWORD lets the installer (see
// install.sh) seed a random password instead of the "admin" dev default —
// it only has any effect on this very first run, same as every other field
// here: once the row exists, this is a no-op, so leaving the env var set
// permanently in the systemd unit is harmless (and doubles as a recovery
// value if the admin row is ever deleted and re-seeded).
func seedAdmin(db *gorm.DB) error {
	var count int64
	if err := db.Model(&models.AdminUser{}).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	password := os.Getenv("WTP_ADMIN_PASSWORD")
	generated := password == ""
	if generated {
		password = "admin"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	admin := models.AdminUser{Username: "admin", PasswordHash: string(hash)}
	if err := db.Create(&admin).Error; err != nil {
		return err
	}
	if generated {
		log.Println("seeded default admin account: admin / admin — change the password immediately")
	} else {
		log.Println("seeded admin account: admin / <password from WTP_ADMIN_PASSWORD>")
	}
	return nil
}
