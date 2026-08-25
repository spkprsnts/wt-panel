package main

import (
	"flag"
	"fmt"
	"log"
	"strings"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"wtpanel/internal/config"
	"wtpanel/internal/db"
	"wtpanel/internal/models"
)

// runSetting implements `wt-panel setting ...` — an offline counterpart to
// the Settings page's API (getAccount/changePassword/getPanelSettings/
// updatePanelSettings) that opens the same sqlite file directly via
// db.Open, with no HTTP server, provisioner.Registry, or xray.Manager
// started at all. install.sh's `wtp` menu is the intended caller: every
// operation here (checking or changing the URI base path, resetting the
// admin password, clearing a bad TLS config) is exactly what's needed to
// recover a panel that won't even start — the API-based route this used to
// require obviously can't help in that situation. The caller is
// responsible for stopping the systemd service first (these fields are
// startup-only/restart-required regardless — see PanelSettings' own doc
// comment — and stopping avoids any concurrent-write risk with a live
// server process holding the same sqlite file open).
func runSetting(args []string) {
	fs := flag.NewFlagSet("setting", flag.ExitOnError)
	show := fs.Bool("show", false, "print current settings and exit")
	password := fs.String("password", "", "set the admin password (min 8 characters)")
	webBasePath := fs.String("webBasePath", "", "set the panel's URI base path (must start and end with /)")
	clearTLS := fs.Bool("clearTls", false, "clear the configured TLS cert/key/domain, reverting to plain HTTP")
	// clearTOTP is the break-glass recovery for 2FA specifically: unlike a
	// forgotten password (recoverable via -password above), a lost/broken
	// authenticator app has no in-app recovery path at all — disableTotp
	// itself requires a valid code, so an admin locked out by 2FA (wrong
	// device time, a botched authenticator import, lost phone, ...) can't
	// self-service through the API or UI even once. This is the same
	// "stop the service, fix the DB directly" escape hatch clearTls already
	// is for a bad TLS config.
	clearTOTP := fs.Bool("clearTotp", false, "disable 2FA for the admin account (use when locked out and unable to enter a valid code)")
	fs.Parse(args)

	cfg := config.Load()
	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}

	changed := false

	if *password != "" {
		if len(*password) < 8 {
			log.Fatal("password must be at least 8 characters")
		}
		var admin models.AdminUser
		if err := database.First(&admin, 1).Error; err != nil {
			log.Fatalf("load admin account: %v", err)
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(*password), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("hash password: %v", err)
		}
		admin.PasswordHash = string(hash)
		if err := database.Save(&admin).Error; err != nil {
			log.Fatalf("save admin account: %v", err)
		}
		changed = true
	}

	if *clearTOTP {
		var admin models.AdminUser
		if err := database.First(&admin, 1).Error; err != nil {
			log.Fatalf("load admin account: %v", err)
		}
		admin.TOTPSecret = ""
		if err := database.Save(&admin).Error; err != nil {
			log.Fatalf("save admin account: %v", err)
		}
		changed = true
	}

	if *webBasePath != "" || *clearTLS {
		var ps models.PanelSettings
		if err := database.First(&ps, 1).Error; err != nil {
			log.Fatalf("load panel settings: %v", err)
		}
		if *webBasePath != "" {
			if !strings.HasPrefix(*webBasePath, "/") || !strings.HasSuffix(*webBasePath, "/") {
				log.Fatal("webBasePath must start and end with '/'")
			}
			ps.BasePath = *webBasePath
		}
		if *clearTLS {
			ps.TLSCertFile = ""
			ps.TLSKeyFile = ""
			ps.ListenDomain = ""
		}
		if err := database.Save(&ps).Error; err != nil {
			log.Fatalf("save panel settings: %v", err)
		}
		changed = true
	}

	if *show || changed {
		printCurrentSettings(database)
	}
}

func printCurrentSettings(database *gorm.DB) {
	var admin models.AdminUser
	if err := database.First(&admin, 1).Error; err != nil {
		log.Fatalf("load admin account: %v", err)
	}
	var ps models.PanelSettings
	if err := database.First(&ps, 1).Error; err != nil {
		log.Fatalf("load panel settings: %v", err)
	}

	fmt.Printf("Login:      %s\n", admin.Username)
	if admin.TOTPSecret != "" {
		fmt.Println("2FA:        on (use -clearTotp if locked out)")
	} else {
		fmt.Println("2FA:        off")
	}
	fmt.Printf("URI path:   %s\n", ps.BasePath)
	if ps.ListenDomain != "" {
		fmt.Printf("Domain:     %s\n", ps.ListenDomain)
	}
	if ps.TLSCertFile != "" && ps.TLSKeyFile != "" {
		fmt.Printf("TLS:        on (%s)\n", ps.TLSCertFile)
	} else {
		fmt.Println("TLS:        off (plain HTTP)")
	}
}
