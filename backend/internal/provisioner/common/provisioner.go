// Package common defines the shared Provisioner contract implemented by
// each of the four WireTurn kernel backends (turnable, olcrtc, webdav,
// freeturn), plus small shared helpers (process supervision, port
// allocation) they all need.
package common

import (
	"context"

	"wtpanel/internal/models"
)

// Provisioner manages one kernel backend's server-side lifecycle for a
// Client's Profile. Implementations differ wildly in cost: FreeTurn shells a
// CLI command into an already-running process; Turnable rewrites a shared
// JSON file and restarts one process; olcRTC/WebDAV spin up a dedicated OS process per profile.
type Provisioner interface {
	Type() models.CoreType

	// AddProfile provisions server-side state for the profile and returns
	// the kernel URI (turnable://, olcrtc://, webdavs://, freeturn://) to
	// embed in the client's ProfileBundle.
	AddProfile(ctx context.Context, profile *models.Profile) (kernelURI string, err error)

	// UpdateProfile applies logical changes (call/room id, transport, peers)
	// to an already-provisioned profile. Infra fields already handed to the
	// client (port, login/password, crypto key) must NOT change — implementations ignore zero-valued fields rather than re-minting them.
	UpdateProfile(ctx context.Context, profile *models.Profile) (kernelURI string, err error)

	// RemoveProfile tears down server-side state for a previously
	// provisioned profile.
	RemoveProfile(ctx context.Context, profile *models.Profile) error

	// Restore re-attaches a supervised process for a profile provisioned
	// before the panel restarted. Must reuse every infra field in
	// profile.CoreConfig verbatim (no new port/secret) — the client already has a URI baked with the old values.
	Restore(ctx context.Context, profile *models.Profile) error

	// Status reports whether this profile's process is currently alive.
	// Returns running=false, pid=0 for a profile with no tracked process
	// (e.g. the panel hasn't called Restore/AddProfile for it in this run).
	Status(profile *models.Profile) (running bool, pid int)

	// Restart stops and starts this profile's process again — the manual
	// counterpart to ProcessSupervisor's automatic crash restart, without the
	// side effect of UpdateProfile re-deriving config. Errors if this profile has no tracked process (never provisioned/restored in this run).
	Restart(profile *models.Profile) error

	// Logs returns up to maxBytes of this profile's process log tail
	// (combined stdout+stderr). maxBytes<=0 means the whole file.
	Logs(profile *models.Profile, maxBytes int) (string, error)

	// Stop halts this profile's process WITHOUT touching persisted state —
	// same contract as Shutdown, for one profile. Backs Profile.Enabled: off
	// calls Stop, back on calls Restore. A no-op, not an error, if nothing is tracked.
	Stop(profile *models.Profile) error

	// Shutdown gracefully stops every supervised process (SIGTERM, bounded
	// wait, Kill as last resort) WITHOUT touching persisted state, unlike
	// RemoveProfile — so RestoreAll brings everything back next start. Call
	// before the panel exits, so kernels get a graceful stop instead of relying on Pdeathsig.
	Shutdown()
}
