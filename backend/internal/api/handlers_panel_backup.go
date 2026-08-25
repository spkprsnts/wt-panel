package api

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"wtpanel/internal/models"
)

// downloadPanelBackup hands the operator a complete, restorable snapshot of
// the panel's entire state — every client/profile, xray inbound/client,
// call room, subscription token, and the panel's own settings/admin
// account — as a single sqlite file, mirroring 3x-ui's own "Backup" button.
// The per-client/per-profile JSON exports elsewhere (exportClientProfiles,
// exportProfile) only ever cover WireTurn-side data for one client; this is
// the "reinstalling on a new VPS, don't lose anything" counterpart.
//
// VACUUM INTO (not a plain file copy) matters specifically because this
// runs against the SAME live database a request could be writing to right
// now: SQLite has no atomic-snapshot guarantee for a raw os.ReadFile of the
// main .db file alone (a concurrent writer could leave it mid-write, and
// depending on journal mode the real current state can be split across the
// main file and a separate -wal/-journal file) — VACUUM INTO is SQLite's
// own built-in way to produce a single, complete, consistent snapshot file
// from a live connection, taking whatever internal locks it needs itself.
func (s *Server) downloadPanelBackup(c *gin.Context) {
	tmpFile, err := os.CreateTemp("", "wtpanel-backup-*.db")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	// VACUUM INTO refuses to write into a file that already exists (even an
	// empty one from CreateTemp above), so it has to be removed first —
	// safe: nothing else can be racing on this just-generated random temp
	// path, and the deferred os.Remove above still cleans up whatever
	// VACUUM INTO itself creates there.
	if err := os.Remove(tmpPath); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := s.db.Exec("VACUUM INTO ?", tmpPath).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "backup snapshot failed: " + err.Error()})
		return
	}

	f, err := os.Open(tmpPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("wt-panel-backup-%s.db", time.Now().UTC().Format("2006-01-02-150405"))
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.DataFromReader(http.StatusOK, info.Size(), "application/vnd.sqlite3", f, nil)
}

// sqliteHeaderMagic is every valid SQLite database file's fixed first 16
// bytes (the format 3.x file header, unchanged since SQLite 3.0) — the
// cheapest possible check that an upload is even the right kind of file
// before restorePanelBackup goes any further with it.
const sqliteHeaderMagic = "SQLite format 3\x00"

// restorePanelBackup replaces the panel's entire database with an uploaded
// backup (see downloadPanelBackup) and restarts the panel to pick it up —
// same "write the new file, then relaunch the process" pattern updatePanel
// already uses for the binary itself (see that handler's own doc comment):
// writing to a ".new" path first and only renaming it over the real path
// once the upload is fully validated means a failed/interrupted upload
// never corrupts the live database out from under the still-running
// process, and the swap only actually takes effect for the fresh process
// relaunchSelf starts right after.
//
// This is maximally destructive by design — every client, profile, and
// xray inbound, plus the admin account itself, all get replaced wholesale
// — so the frontend is expected to have already gotten an explicit, scary
// confirmation before ever calling this. PanelSettings is the one
// exception: see prepareRestoredDB for why THIS machine's own copy wins
// over whatever the backup says.
func (s *Server) restorePanelBackup(c *gin.Context) {
	// restoreNetworkSettings opts INTO the backup's own ListenIP/
	// ListenDomain/TLSCertFile/etc — the operator has to explicitly ask for
	// that. Default (unset/false) is the realistic case: restoring a
	// backup taken on a different VPS onto one already set up (via
	// install.sh) with its own correct network identity, where the
	// backup's copy would just be wrong here.
	restoreNetworkSettings := c.PostForm("restoreNetworkSettings") == "true"

	// Captured before anything else so it's available to fall back to —
	// reflects THIS panel's own network/TLS setup, not the uploaded file's
	// — see prepareRestoredDB.
	var currentSettings models.PanelSettings
	if err := s.db.First(&currentSettings, 1).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read current panel settings: " + err.Error()})
		return
	}

	file, err := c.FormFile("backup")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no backup file uploaded"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer src.Close()

	header := make([]byte, len(sqliteHeaderMagic))
	if _, err := io.ReadFull(src, header); err != nil || string(header) != sqliteHeaderMagic {
		c.JSON(http.StatusBadRequest, gin.H{"error": "not a valid sqlite database file"})
		return
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	newPath := s.cfg.DBPath + ".new"
	dst, err := os.Create(newPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(newPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	dst.Close()

	// Sanity-checks the upload is actually a wt-panel database (right
	// schema, a real admin account in it) and, unless the operator opted
	// into restoreNetworkSettings, overwrites its PanelSettings row with
	// currentSettings — both before this ever gets committed to, since a
	// structurally valid but unrelated sqlite file, or the old machine's
	// now-wrong network identity, would otherwise only be discovered after
	// the restart already happened and the OLD database is already gone.
	keepSettings := &currentSettings
	if restoreNetworkSettings {
		keepSettings = nil
	}
	if err := prepareRestoredDB(newPath, keepSettings); err != nil {
		os.Remove(newPath)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := os.Rename(newPath, s.cfg.DBPath); err != nil {
		os.Remove(newPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"restoring": true})
	go func() {
		time.Sleep(300 * time.Millisecond)
		select {
		case s.restartCh <- struct{}{}:
		default:
		}
	}()
}

// prepareRestoredDB opens path as its own independent connection (NOT
// s.db — the live one must stay untouched until the restart actually
// happens), validates it has an admin_users table with at least one row,
// and — when keepSettings is non-nil — overwrites its PanelSettings row
// (id 1) with it instead of whatever the backup itself contains.
//
// ListenIP/ListenPort/ListenDomain/BasePath/TLSCertFile/TLSKeyFile/
// PublicIP/WebDAVPublicHost all describe one specific machine — which
// interface it binds, the file paths of a certificate that only exists on
// THAT disk, the IP that box was actually detected/configured to have —
// so restorePanelBackup defaults to keepSettings = this machine's own
// current row: the realistic restore workflow is "install.sh already set
// THIS box's IP/domain/SSL up, now bring back the data (clients, profiles,
// xray config, the admin account) from the old one," not to also drag the
// old box's now-wrong network identity along for the ride. keepSettings is
// nil only when the operator explicitly opted into restoring the backup's
// own network settings too (restorePanelBackup's restoreNetworkSettings
// flag) — e.g. restoring onto the very same machine the backup came from.
func prepareRestoredDB(path string, keepSettings *models.PanelSettings) error {
	restored, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		return fmt.Errorf("not a readable sqlite database: %w", err)
	}
	sqlDB, err := restored.DB()
	if err == nil {
		defer sqlDB.Close()
	}

	var count int64
	if err := restored.Model(&models.AdminUser{}).Count(&count).Error; err != nil {
		return fmt.Errorf("doesn't look like a wt-panel backup (no admin_users table): %w", err)
	}
	if count == 0 {
		return fmt.Errorf("backup file has no admin account in it")
	}

	if keepSettings != nil {
		if err := restored.Save(keepSettings).Error; err != nil {
			return fmt.Errorf("failed to preserve this machine's own panel settings: %w", err)
		}
	}
	return nil
}
