// Package common defines the shared Provisioner contract implemented by
// each of the four WireTurn kernel backends (turnable, olcrtc, webdav,
// freeturn), plus small shared helpers (process supervision, port
// allocation) they all need.
package common

import (
	"context"

	"wtpanel/internal/models"
)

// Provisioner manages the lifecycle of one kernel backend's server-side
// state for a Client's Profile. Implementations differ wildly in cost:
// FreeTurn just shells a CLI command into an already-running, hot-reloading
// process; Turnable rewrites a shared JSON file and restarts one process;
// olcRTC and WebDAV spin up a dedicated OS process per profile.
type Provisioner interface {
	Type() models.CoreType

	// AddProfile provisions server-side state for the profile and returns
	// the kernel URI (turnable://, olcrtc://, webdavs://, freeturn://) to
	// embed in the client's ProfileBundle.
	AddProfile(ctx context.Context, profile *models.Profile) (kernelURI string, err error)

	// UpdateProfile applies logical changes (e.g. call/room id, transport,
	// peers) to an already-provisioned profile. Infra fields the client was
	// already handed — port, login/password, crypto key — must NOT change,
	// so implementations ignore zero-valued fields on the incoming
	// profile.CoreConfig rather than re-minting them.
	UpdateProfile(ctx context.Context, profile *models.Profile) (kernelURI string, err error)

	// RemoveProfile tears down server-side state for a previously
	// provisioned profile.
	RemoveProfile(ctx context.Context, profile *models.Profile) error

	// Restore re-attaches a supervised process for a profile that was
	// already provisioned before the panel process restarted. It must
	// reuse every infra field already stored in profile.CoreConfig
	// verbatim (no new port/secret), since the client already has a URI
	// baked with the old values.
	Restore(ctx context.Context, profile *models.Profile) error

	// Status reports whether this profile's process is currently alive.
	// Returns running=false, pid=0 for a profile with no tracked process
	// (e.g. the panel hasn't called Restore/AddProfile for it in this run).
	Status(profile *models.Profile) (running bool, pid int)

	// Restart stops and starts this profile's process again — the manual
	// counterpart to ProcessSupervisor's automatic crash restart, for an
	// operator who wants to kick a stuck/misbehaving process without
	// waiting for it to crash on its own (or without the side effect of
	// UpdateProfile re-deriving config). Errors if this profile has no
	// tracked process at all (never provisioned/restored in this run).
	Restart(profile *models.Profile) error

	// Logs returns up to maxBytes of this profile's process log tail
	// (combined stdout+stderr). maxBytes<=0 means the whole file.
	Logs(profile *models.Profile, maxBytes int) (string, error)

	// Stop halts this profile's process (if any is tracked) WITHOUT
	// touching its persisted state — same "config survives, only the
	// process stops" contract as Shutdown, for one profile. Backs
	// Profile.Enabled: turning a profile off calls Stop, turning it back on
	// calls Restore (reusing the port/keys already in profile.CoreConfig).
	// A no-op, not an error, for a profile with no tracked process.
	Stop(profile *models.Profile) error

	// Shutdown gracefully stops every currently-supervised process (SIGTERM,
	// bounded wait, Kill as a last resort — see ProcessSupervisor.Stop)
	// WITHOUT touching any persisted state: unlike RemoveProfile, config
	// files and DB rows stay untouched, so RestoreAll brings everything back
	// on the next start. Call this before the panel process exits, so
	// kernel binaries get a graceful stop instead of relying on the
	// Pdeathsig fallback (see process_lifetime.go).
	Shutdown()
}
