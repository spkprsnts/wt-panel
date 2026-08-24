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
	// "setting" is an offline subcommand (wt-panel setting -show/-password/
	// -webBasePath/-clearTls — see setting.go) that only opens the sqlite
	// file directly, with no HTTP server or kernel/xray startup at all —
	// intercepted before the normal flag set below since it has its own
	// flags and never falls through to the rest of main(). install.sh's
	// `wtp` menu is the intended caller, precisely for when the panel won't
	// even start and the API-based route can't help.
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
	// PanelSettings.PublicIP (edited on the Settings page, auto-detected on
	// first run — see db.seedPanelSettings) is the authoritative source
	// once it's set; WTP_PUBLIC_IP only matters before that first save.
	// This has to happen before turnable.New/freeturn.New below — they
	// capture cfg.PublicIP into each profile's rendered config at Add time.
	if panelSettings.PublicIP != "" {
		cfg.PublicIP = panelSettings.PublicIP
	}
	// Same authoritative-once-set pattern as PublicIP above — see
	// config.Config.ResolvedWebDAVPublicHost, which otherwise falls back to
	// cfg.PublicIP unchanged.
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

	// Kernel processes started by a previous run of this panel don't
	// survive across a restart on their own (a graceful stop tears them
	// down deliberately below, and a crash leaves the OS to enforce it via
	// Pdeathsig — see provisioner/common), so
	// re-attach fresh ones from whatever's already in the database before
	// serving traffic.
	registry.RestoreAll(startupCtx, database)

	// xrayMgr owns the single shared xray-core process serving every
	// enabled XrayInbound — Reload here brings it up on startup the same
	// way registry.RestoreAll just did for the four kernels; every later
	// mutation to an inbound/client calls Reload again (see
	// api/handlers_xray.go's reloadXray). Best-effort: xray-core may not be
	// installed yet (see the "Ядра" page), which shouldn't block the panel
	// itself from starting.
	xrayMgr := xray.NewManager(cfg, database)
	if err := xrayMgr.Reload(); err != nil {
		log.Printf("xray-core startup reload: %v", err)
	}

	// restartCh is how the Settings page's "Перезапустить панель" button
	// reaches the select loop below — see api.restartPanel. BasePath is
	// passed in so the served index.html can tell the SPA what prefix it's
	// actually running under — see server.serveWebUI's doc comment.
	restartCh := make(chan struct{}, 1)
	router := api.New(database, cfg, authSvc, registry, restartCh, panelSettings.BasePath, xrayMgr, version)

	addr, handler := applyPanelSettings(cfg.ListenAddr, &panelSettings, router)
	httpServer := &http.Server{Addr: addr, Handler: handler}

	// Catch SIGINT/SIGTERM (Ctrl+C, `systemctl stop`'s default signal) so
	// we get a chance to stop every kernel process gracefully (SIGTERM,
	// letting each kernel binary run its own shutdown logic) before this
	// process actually exits. Without this, os/signal's default
	// disposition for these terminates the process immediately — no
	// different from a crash — and every kernel process would only be
	// saved by the OS-level Pdeathsig fallback, which is a
	// SIGKILL with no chance for the kernel binary to clean up after itself.
	signalCtx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	// Validating the cert/key pair up front — rather than just calling
	// ListenAndServeTLS and inspecting whatever error comes back — lets a
	// bad path/unreadable/corrupt cert fall back to plain HTTP with a
	// warning instead of taking the whole panel down. Before this, a wrong
	// TLSCertFile/TLSKeyFile (e.g. from install.sh's SSL setup writing a
	// bad path — see setup_ssl) hit log.Fatalf on every single restart:
	// the service crash-looped indefinitely with no working HTTP listener
	// at all, so there was no way to reach the Settings page to fix it
	// short of editing the database directly.
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

// relaunchSelf re-execs the running binary with the same args and
// environment, in place — same PID, not a spawned child — so main() gets to
// re-read PanelSettings (and everything else config.Load() reads from the
// environment) from scratch, which is what makes the Settings page's
// restart button an actual restart instead of just a "changes need a
// restart" note.
//
// This used to spawn a detached child via exec.Command(...).Start() and let
// this process return/exit(0) afterward — which looked fine standalone, but
// under systemd (Type=simple, Restart=on-failure, no User=) it broke the
// service outright: systemd tracks the ORIGINAL pid from ExecStart, and a
// clean exit(0) is not a "failure", so Restart=on-failure never fires —
// systemd just marks the unit "inactive (dead)" while the new child runs
// completely unsupervised outside it, unable to be tracked, restarted, or
// stopped normally again. Confirmed on a real VPS: every click of
// "Перезапустить панель" left the unit dead. syscall.Exec instead replaces
// this process's own image without changing its pid at all, so systemd
// never sees anything happen — from its point of view the exact same
// process just keeps running, now executing the fresh binary.
//
// Caveat: under `go run`, os.Executable() resolves to the transient binary
// the go tool builds into a temp dir for that invocation — relaunching it
// works, but only while go run's own temp dir is still alive, so this is
// only reliable for the real production case (a compiled binary launched
// directly), which is what it's meant for.
func relaunchSelf() error {
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	return syscall.Exec(exe, append([]string{exe}, os.Args[1:]...), os.Environ())
}

// applyPanelSettings folds the PanelSettings singleton (edited via the
// Settings page, see handlers_panel_settings.go) on top of the
// WTP_LISTEN_ADDR-derived default: an empty ListenIP/ListenPort/
// ListenDomain/BasePath each fall back to "no restriction" rather than
// erroring, so a freshly seeded all-defaults row behaves exactly like the
// panel did before this existed. BasePath prefixing is done by wrapping the
// gin engine behind a plain http.ServeMux + http.StripPrefix rather than by
// changing route registration in server.go, so every route only has to be
// written once, unprefixed.
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

		// /sub/:token is the public endpoint WireTurn clients poll directly
		// (shared as its own link, security comes from the token itself
		// being an unguessable 24-byte random string — see
		// createSubscriptionToken) — not an admin surface, so the URI-path
		// setting (which exists to hide the *admin* login/API from mass
		// scanners) shouldn't gate it too. Mounted unprefixed, straight at
		// the same router, unstripped: gin's "/sub/:token" route matches
		// the request path exactly as the client sent it.
		mux.Handle("/sub/", router)

		// The embedded frontend's index.html references its JS/CSS by
		// root-absolute path (Vite's default output: src="/assets/...")
		// — the browser requests those at the real domain root regardless
		// of what path it loaded the page from, so they have to resolve
		// there too even when the app itself only answers under the secret
		// base path. This doesn't defeat the base path's purpose (hiding
		// the panel's actual routes — login, API, SPA shell — from mass
		// scanners): it's a plain http.FileServer with no SPA/index.html
		// fallback, so an unprefixed request only ever gets a real static
		// file or a 404, never the app.
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
				http.NotFound(w, r)
				return
			}
			inner.ServeHTTP(w, r)
		})
	}

	return addr, handler
}
