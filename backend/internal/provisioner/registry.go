package provisioner

import (
	"context"
	"fmt"
	"log"
	"sync"

	"gorm.io/gorm"

	"wtpanel/internal/models"
	"wtpanel/internal/provisioner/common"
)

// Registry dispatches to the right kernel Provisioner by CoreType.
type Registry struct {
	byType map[models.CoreType]common.Provisioner
}

func NewRegistry(provisioners ...common.Provisioner) *Registry {
	r := &Registry{byType: make(map[models.CoreType]common.Provisioner)}
	for _, p := range provisioners {
		r.byType[p.Type()] = p
	}
	return r
}

func (r *Registry) For(coreType models.CoreType) (common.Provisioner, error) {
	p, ok := r.byType[coreType]
	if !ok {
		return nil, fmt.Errorf("no provisioner registered for core type %q", coreType)
	}
	return p, nil
}

// FillStatus populates profile.Running/PID from its provisioner's live
// process state. Best-effort: an unknown core type just leaves both zero
// rather than failing the whole response.
func (r *Registry) FillStatus(profile *models.Profile) {
	prov, err := r.For(profile.CoreType)
	if err != nil {
		return
	}
	profile.Running, profile.PID = prov.Status(profile)
}

// Logs returns the tail of a profile's process log via its provisioner.
func (r *Registry) Logs(profile *models.Profile, maxBytes int) (string, error) {
	prov, err := r.For(profile.CoreType)
	if err != nil {
		return "", err
	}
	return prov.Logs(profile, maxBytes)
}

// Restart stops and starts a profile's process again via its provisioner —
// the manual counterpart to ProcessSupervisor's automatic crash restart.
func (r *Registry) Restart(profile *models.Profile) error {
	prov, err := r.For(profile.CoreType)
	if err != nil {
		return err
	}
	return prov.Restart(profile)
}

// RestoreAll re-attaches a supervised process for every profile already in
// the database. Every kernel here runs one OS process per profile, and
// those processes obviously don't survive the panel itself restarting, so
// without this every previously-issued profile would silently stop working
// on the next deploy/restart. Failures are logged, not fatal — one bad
// profile shouldn't block the rest from coming back up.
func (r *Registry) RestoreAll(ctx context.Context, db *gorm.DB) {
	var profiles []models.Profile
	if err := db.Find(&profiles).Error; err != nil {
		log.Printf("restore: failed to load profiles: %v", err)
		return
	}
	for _, profile := range profiles {
		prov, err := r.For(profile.CoreType)
		if err != nil {
			log.Printf("restore: profile %s: %v", profile.ExternalID, err)
			continue
		}
		if err := prov.Restore(ctx, &profile); err != nil {
			log.Printf("restore: profile %s (%s): %v", profile.ExternalID, profile.CoreType, err)
		}
	}
}

// ShutdownAll gracefully stops every currently-running kernel process
// across all four provisioners (SIGTERM, bounded wait, Kill as a last
// resort) without touching persisted state, so RestoreAll brings
// everything back on the next start. Call this from the panel's own
// shutdown sequence before the process actually exits — see main.go — so
// kernel binaries get a real chance to run their own shutdown logic
// instead of being hard-killed by Pdeathsig the moment this process
// disappears.
func (r *Registry) ShutdownAll() {
	var wg sync.WaitGroup
	for _, prov := range r.byType {
		wg.Add(1)
		go func(prov common.Provisioner) {
			defer wg.Done()
			prov.Shutdown()
		}(prov)
	}
	wg.Wait()
}
