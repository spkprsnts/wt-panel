package api

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/kernels"
	"wtpanel/internal/models"
)

type kernelStatus struct {
	CoreType    models.CoreType `json:"coreType"`
	Installed   bool            `json:"installed"` // binary file currently exists at its configured path
	Version     string          `json:"version,omitempty"`
	Source      string          `json:"source,omitempty"` // "release" or "build"
	InstalledAt *time.Time      `json:"installedAt,omitempty"`
	BinPath     string          `json:"binPath"`
}

// listKernels reports what's currently installed for each of the three
// kernels this panel can manage installs for (WebDAV isn't part of this
// yet, same as it's excluded from profile creation — see README).
func (s *Server) listKernels(c *gin.Context) {
	paths := map[models.CoreType]string{
		models.CoreTurnable: s.cfg.TurnableBinPath,
		models.CoreFreeTurn: s.cfg.FreeTurnBinPath,
		models.CoreOlcRTC:   s.cfg.OlcRTCBinPath,
		models.CoreXray:     s.cfg.XrayBinPath,
	}

	var installs []models.KernelInstall
	s.db.Find(&installs)
	byType := make(map[models.CoreType]models.KernelInstall)
	for _, in := range installs {
		byType[in.CoreType] = in
	}

	result := make([]kernelStatus, 0, len(paths))
	for coreType, path := range paths {
		_, statErr := os.Stat(path)
		status := kernelStatus{CoreType: coreType, Installed: statErr == nil, BinPath: path}
		if in, ok := byType[coreType]; ok {
			status.Version = in.Version
			status.Source = in.Source
			status.InstalledAt = &in.InstalledAt
		}
		result = append(result, status)
	}
	c.JSON(http.StatusOK, result)
}

// wantsRefresh reports whether the request asked to bypass the releases/
// commits cache (see kernels.ListReleases/ListCommits) — the Kernels
// page's "обновить список" button sends ?refresh=1.
func wantsRefresh(c *gin.Context) bool {
	return c.Query("refresh") == "1" || c.Query("refresh") == "true"
}

func (s *Server) listTurnableReleases(c *gin.Context) {
	releases, err := kernels.ListReleases("TheAirBlow", "Turnable", 20, wantsRefresh(c))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, releases)
}

func (s *Server) listFreeTurnReleases(c *gin.Context) {
	releases, err := kernels.ListReleases("samosvalishe", "free-turn-proxy", 20, wantsRefresh(c))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, releases)
}

func (s *Server) listXrayReleases(c *gin.Context) {
	releases, err := kernels.ListReleases("XTLS", "Xray-core", 20, wantsRefresh(c))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, releases)
}

func (s *Server) listOlcrtcCommits(c *gin.Context) {
	commits, err := kernels.ListCommits("openlibrecommunity", "olcrtc", 30, wantsRefresh(c))
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, commits)
}

type installReleaseRequest struct {
	Version string `json:"version"` // release tag; empty = latest
}

// installTurnable, installFreeTurn and installXray all kick off the actual
// download as a background Job (same model as buildOlcrtc below) instead of
// blocking the request until it finishes: a plain synchronous request has
// no way to tell the operator "still installing" if they reload the Ядра
// page mid-download, since the "installing..." state lived only in the
// browser tab's own React state. Polling getKernelJob (by kernel name, not
// by an id the frontend would otherwise have to remember across a reload)
// fixes that uniformly for all four kernels, including olcRTC's build.

func (s *Server) installTurnable(c *gin.Context) {
	var req installReleaseRequest
	_ = c.ShouldBindJSON(&req)

	job := s.jobs.StartInstall("turnable", req.Version, func() (string, error) {
		return kernels.InstallRelease("TheAirBlow", "Turnable", req.Version,
			kernels.TurnableAssetName(), s.cfg.TurnableBinPath)
	}, func(version string) {
		s.recordKernelInstall(models.CoreTurnable, version, "release", "")
	})
	c.JSON(http.StatusAccepted, job)
}

func (s *Server) installFreeTurn(c *gin.Context) {
	var req installReleaseRequest
	_ = c.ShouldBindJSON(&req)

	job := s.jobs.StartInstall("freeturn", req.Version, func() (string, error) {
		return kernels.InstallRelease("samosvalishe", "free-turn-proxy", req.Version,
			kernels.FreeTurnAssetName(), s.cfg.FreeTurnBinPath)
	}, func(version string) {
		s.recordKernelInstall(models.CoreFreeTurn, version, "release", "")
	})
	c.JSON(http.StatusAccepted, job)
}

// installXray downloads Xray-core's zip release asset for this platform and
// extracts just the binary — unlike Turnable/FreeTurn, whose release assets
// are the bare binary already (see kernels.DownloadBinary).
func (s *Server) installXray(c *gin.Context) {
	var req installReleaseRequest
	_ = c.ShouldBindJSON(&req)

	assetName := kernels.XrayAssetName()
	if assetName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unsupported platform for Xray-core auto-install"})
		return
	}

	job := s.jobs.StartInstall("xray", req.Version, func() (string, error) {
		return kernels.InstallReleaseZipEntry("XTLS", "Xray-core", req.Version,
			assetName, kernels.XrayZipEntryName(), s.cfg.XrayBinPath)
	}, func(version string) {
		s.recordKernelInstall(models.CoreXray, version, "release", "")
		if s.xrayMgr != nil {
			if err := s.xrayMgr.Reload(); err != nil {
				log.Printf("xray-core reload after install: %v", err)
			}
		}
	})
	c.JSON(http.StatusAccepted, job)
}

type buildOlcrtcRequest struct {
	Ref string `json:"ref" binding:"required"` // commit SHA or branch name
}

func (s *Server) buildOlcrtc(c *gin.Context) {
	var req buildOlcrtcRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// onSuccess fires from the build's own background goroutine once it
	// actually finishes — not from a client polling getOlcrtcBuildJob below
	// — so the KernelInstall row gets recorded even if the operator reloads
	// the page (or never comes back) before the build completes. See
	// JobManager.StartOlcRTCBuild's doc comment.
	job := s.jobs.StartOlcRTCBuild(req.Ref, s.cfg.OlcRTCBinPath, func(version, log string) {
		s.recordKernelInstall(models.CoreOlcRTC, version, "build", log)
	})
	c.JSON(http.StatusAccepted, job)
}

// getKernelJob returns the most recently started job for a kernel
// ("turnable"/"freeturn"/"xray"/"olcrtc") — 404 if none has run yet this
// process lifetime. Keyed by kernel name rather than a job id so the
// Kernels page can resume showing accurate progress (or the last result)
// after a full reload without having remembered anything itself.
func (s *Server) getKernelJob(c *gin.Context) {
	job, ok := s.jobs.LatestJob(c.Param("name"))
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "no job for this kernel"})
		return
	}
	c.JSON(http.StatusOK, job)
}

// recordKernelInstall upserts the single KernelInstall row for coreType.
// Best-effort: a failure here doesn't undo an already-installed binary.
func (s *Server) recordKernelInstall(coreType models.CoreType, version, source, buildLog string) {
	var existing models.KernelInstall
	err := s.db.Where("core_type = ?", coreType).First(&existing).Error
	now := time.Now()
	if err != nil {
		s.db.Create(&models.KernelInstall{
			CoreType: coreType, Version: version, Source: source,
			InstalledAt: now, BuildLog: buildLog,
		})
		return
	}
	if existing.Version == version && existing.Source == source {
		return // already recorded (e.g. repeated poll of a finished build job)
	}
	existing.Version = version
	existing.Source = source
	existing.InstalledAt = now
	if buildLog != "" {
		existing.BuildLog = buildLog
	}
	s.db.Save(&existing)
}
