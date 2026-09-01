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
	// IgnoreRecordNotFoundError silences GORM's default error-level log for ErrRecordNotFound, which
	// callers like recordKernelInstall use as an expected create-if-missing branch.
	gormLogger := logger.New(log.New(os.Stderr, "", log.LstdFlags), logger.Config{
		SlowThreshold:             200 * time.Millisecond,
		LogLevel:                  logger.Warn,
		IgnoreRecordNotFoundError: true,
	})

	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{Logger: gormLogger})
	if err != nil {
		return nil, err
	}

	// SQLite has no real concurrent-writer story; pinning to one connection serializes every query
	// through it, the standard defensive default for Go+SQLite.
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

// seedPanelSettings creates the singleton PanelSettings row (id 1) on first run, so callers can
// always assume row 1 exists. WTP_INITIAL_BASE_PATH lets the installer seed a random URI path
// instead of "/", first-run-only like seedAdmin's WTP_ADMIN_PASSWORD.
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

	// Explicit WTP_PUBLIC_IP wins if set, else best-effort auto-detect — a blank public_ip is exactly
	// what makes Turnable refuse to start. Detection failure just leaves it empty for the operator to
	// fill in on the Settings page; never fatal to startup.
	publicIP := os.Getenv("WTP_PUBLIC_IP")
	if publicIP == "" {
		publicIP = detectPublicIP()
	}
	webdavPublicHost := os.Getenv("WTP_WEBDAV_PUBLIC_HOST")
	return db.Create(&models.PanelSettings{
		BasePath:         basePath,
		PublicIP:         publicIP,
		WebDAVPublicHost: webdavPublicHost,
	}).Error
}

// detectPublicIP asks a couple of plain-text "what's my IP" endpoints, first one to answer with a
// parseable IP wins; only ever pre-fills a field the operator can overwrite, so failure is swallowed.
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

// seedAdmin creates the initial admin account on first run. WTP_ADMIN_PASSWORD lets install.sh seed
// a random password instead of the "admin" dev default; only effective on first run, so leaving the
// env var set in the systemd unit is harmless (and doubles as a recovery value if re-seeded).
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
