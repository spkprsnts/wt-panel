package main

import (
	"context"
	"crypto/tls"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"wtpanel/internal/api"
	"wtpanel/internal/auth"
	"wtpanel/internal/config"
	"wtpanel/internal/db"
	"wtpanel/internal/models"
	"wtpanel/internal/provisioner"
	"wtpanel/internal/provisioner/freeturn"
	"wtpanel/internal/provisioner/olcrtc"
	"wtpanel/internal/provisioner/turnable"
	wdav "wtpanel/internal/provisioner/webdav"
	"wtpanel/internal/webui"
	"wtpanel/internal/xray"
)

// version is set at build time via -ldflags "-X main.version=vX.Y.Z" (see
// .goreleaser.yaml) — "dev" for a plain `go build`/`go run`, same convention
// webdav-tunnel's own main.version uses.
var version = "dev"

func main() {
	// "setting" (see setting.go) opens the sqlite file directly with no HTTP
	// server or kernel startup — for when the panel won't even start.
	if len(os.Args) > 1 && os.Args[1] == "setting" {
		runSetting(os.Args[2:])
		return
	}

	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}

	cfg := config.Load()

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}

	var panelSettings models.PanelSettings
	if err := database.First(&panelSettings, 1).Error; err != nil {
		log.Fatalf("load panel settings: %v", err)
	}
	// PanelSettings (DB) wins over WTP_PUBLIC_IP/WTP_WEBDAV_PUBLIC_HOST once
	// set — must happen before turnable.New/freeturn.New below, which
	// capture cfg.PublicIP into each profile's rendered config.
	if panelSettings.PublicIP != "" {
		cfg.PublicIP = panelSettings.PublicIP
	}
	if panelSettings.WebDAVPublicHost != "" {
		cfg.WebDAVPublicHost = panelSettings.WebDAVPublicHost
	}

	authSvc := auth.NewService(cfg.JWTSecret)

	startupCtx := context.Background()

	registry := provisioner.NewRegistry(
		turnable.New(cfg),
		freeturn.New(cfg),
		olcrtc.New(cfg),
		wdav.New(cfg),
	)

	// Kernel processes don't survive a panel restart on their own — re-attach
	// fresh ones from the database before serving traffic.
	registry.RestoreAll(startupCtx, database)

	// xray-core may not be installed yet (see the "Kernels" page); a reload
	// failure here shouldn't block the panel itself from starting.
	xrayMgr := xray.NewManager(cfg, database)
	if err := xrayMgr.Reload(); err != nil {
		log.Printf("xray-core startup reload: %v", err)
	}

	// restartCh is how the Settings page's "Restart panel" button reaches
	// the select loop below — see api.restartPanel.
	restartCh := make(chan struct{}, 1)
	router := api.New(database, cfg, authSvc, registry, restartCh, panelSettings.BasePath, xrayMgr, version)

	addr, handler := applyPanelSettings(cfg.ListenAddr, &panelSettings, router)
	httpServer := &http.Server{Addr: addr, Handler: handler}

	// Catch SIGINT/SIGTERM so kernel processes get a graceful SIGTERM below
	// instead of just the OS-level Pdeathsig SIGKILL fallback.
	signalCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	// Validate the cert/key up front so a bad TLSCertFile/TLSKeyFile falls
	// back to plain HTTP with a warning instead of log.Fatalf crash-looping
	// the service with no way to reach Settings and fix it.
	useTLS := false
	if panelSettings.TLSCertFile != "" && panelSettings.TLSKeyFile != "" {
		if _, err := tls.LoadX509KeyPair(panelSettings.TLSCertFile, panelSettings.TLSKeyFile); err != nil {
			log.Printf("WARNING: TLS cert/key invalid (%v) — falling back to plain HTTP on %s. Fix the paths on the Settings page.", err, addr)
		} else {
			useTLS = true
		}
	}

	serveErr := make(chan error, 1)
	go func() {
		var err error
		if useTLS {
			log.Printf("wt-panel %s listening on %s (TLS)", version, addr)
			err = httpServer.ListenAndServeTLS(panelSettings.TLSCertFile, panelSettings.TLSKeyFile)
		} else {
			log.Printf("wt-panel %s listening on %s", version, addr)
			err = httpServer.ListenAndServe()
		}
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
			return
		}
		serveErr <- nil
	}()

	select {
	case err := <-serveErr:
		if err != nil {
			log.Fatalf("server error: %v", err)
		}
	case <-signalCtx.Done():
		log.Println("shutting down: stopping HTTP server and every kernel process...")
		stopSignals() // restore default signal behavior in case shutdown itself hangs

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("http server shutdown: %v", err)
		}

		registry.ShutdownAll()
		xrayMgr.Shutdown()
		log.Println("shutdown complete")

	case <-restartCh:
		log.Println("restart requested from the Settings page: stopping HTTP server and every kernel process...")
		stopSignals()

		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("http server shutdown: %v", err)
		}
		registry.ShutdownAll()
		xrayMgr.Shutdown()

		// Only after the port is actually released (Shutdown above closed
		// the listener) do we spawn the replacement — starting it earlier
		// risks "address already in use" whenever the port setting didn't
		// change, which is the common case.
		if err := relaunchSelf(); err != nil {
			log.Fatalf("restart: failed to relaunch: %v — panel is now stopped, start it manually", err)
		}
		log.Println("relaunched — new process re-reads panel settings from here on; exiting this one")
	}
}

// relaunchSelf re-execs the running binary in place (same PID, not a spawned
// child) so main() re-reads config from scratch. Must keep the same PID: a
// prior version spawned a child and exit(0)'d instead, which left systemd's
// Restart=on-failure never firing (a clean exit isn't a "failure") and the
// unit dead — confirmed on a real VPS. Only reliable for a compiled binary;
// under `go run`, os.Executable() points at a temp dir that may be gone.
func relaunchSelf() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syscall.Exec(exe, append([]string{exe}, os.Args[1:]...), os.Environ())
}

// applyPanelSettings folds the PanelSettings singleton on top of the
// WTP_LISTEN_ADDR default (empty fields = no restriction). BasePath
// prefixing wraps the gin engine in a plain http.ServeMux + StripPrefix so
// routes in server.go stay unprefixed.
func applyPanelSettings(defaultListenAddr string, ps *models.PanelSettings, router http.Handler) (addr string, handler http.Handler) {
	_, defaultPort, err := net.SplitHostPort(defaultListenAddr)
	if err != nil {
		defaultPort = "8090"
	}
	port := defaultPort
	if ps.ListenPort != 0 {
		port = strconv.Itoa(ps.ListenPort)
	}
	addr = net.JoinHostPort(ps.ListenIP, port)

	handler = router
	base := ps.BasePath
	if base != "" && base != "/" {
		prefix := strings.TrimSuffix(base, "/")
		mux := http.NewServeMux()
		mux.Handle(base, http.StripPrefix(prefix, router))

		// /sub/:token is public (security is the token itself, an
		// unguessable random string) — not an admin surface, so it's mounted
		// unprefixed rather than gated behind the secret base path too.
		mux.Handle("/sub/", router)

		// The SPA's JS/CSS load from root-absolute paths (Vite's default
		// output), so they must resolve there too even though the app itself
		// only answers under the base path. Safe: plain http.FileServer with
		// no index.html fallback, so an unprefixed request never reaches the app.
		if dist, err := webui.DistFS(); err == nil {
			staticHandler := http.FileServer(http.FS(dist))
			mux.Handle("/assets/", staticHandler)
		}

		handler = mux
	}

	if ps.ListenDomain != "" {
		inner := handler
		domain := ps.ListenDomain
		handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			host := r.Host
			if h, _, splitErr := net.SplitHostPort(host); splitErr == nil {
				host = h
			}
			if host != domain {
				// 403, not 404 — a real vhost check, not a missing route.
				http.Error(w, http.StatusText(http.StatusForbidden), http.StatusForbidden)
				return
			}
			inner.ServeHTTP(w, r)
		})
	}

	return addr, handler
}
