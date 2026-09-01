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

// downloadPanelBackup hands the operator a complete, restorable snapshot of the panel's entire
// state (unlike exportClientProfiles/exportProfile, which only cover one client's WireTurn-side
// data) as a single sqlite file — the "reinstalling on a new VPS" counterpart. VACUUM INTO, not a
// plain file copy, is required because this runs against the live database: a raw os.ReadFile has
// no atomic-snapshot guarantee against a concurrent writer or a split main/-wal state.
func (s *Server) downloadPanelBackup(c *gin.Context) {
	tmpFile, err := os.CreateTemp("", "wtpanel-backup-*.db")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tmpPath := tmpFile.Name()
	tmpFile.Close()
	defer os.Remove(tmpPath)

	// VACUUM INTO refuses to write into a file that already exists (even the empty one CreateTemp made),
	// so remove it first — safe since nothing else can race on this fresh random temp path.
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

// sqliteHeaderMagic is every valid SQLite file's fixed first 16 bytes — the cheapest check that an
// upload is even the right kind of file before restorePanelBackup goes further.
const sqliteHeaderMagic = "SQLite format 3\x00"

// restorePanelBackup replaces the panel's entire database with an uploaded backup and restarts to
// pick it up — same "write to '.new', then relaunch" pattern as updatePanel, so a failed/interrupted
// upload never corrupts the live database. Maximally destructive by design (every client, profile,
// xray inbound, and the admin account get replaced wholesale), so the frontend must confirm before
// calling this. PanelSettings is the one exception — see prepareRestoredDB.
func (s *Server) restorePanelBackup(c *gin.Context) {
	// restoreNetworkSettings opts INTO the backup's own ListenIP/ListenDomain/TLSCertFile/etc; default
	// is off since restoring onto a different, already-set-up VPS makes the backup's copy wrong here.
	restoreNetworkSettings := c.PostForm("restoreNetworkSettings") == "true"

	// Captured before anything else as the fallback — see prepareRestoredDB.
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

	// Sanity-checks the upload is a wt-panel database and, unless restoreNetworkSettings, overwrites
	// its PanelSettings with currentSettings — both before commit, since a bad file or wrong network
	// identity would otherwise only surface after the restart, once the old database is already gone.
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

// prepareRestoredDB opens path as its own independent connection (not s.db — the live one stays
// untouched until the restart), validates it has an admin_users table with at least one row, and —
// when keepSettings is non-nil — overwrites its PanelSettings row (id 1) with it instead of the
// backup's own. ListenIP/Port/Domain/BasePath/TLSCertFile/TLSKeyFile/PublicIP/WebDAVPublicHost
// describe one specific machine, so keepSettings defaults to this machine's own row rather than
// dragging the old box's network identity along.
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
