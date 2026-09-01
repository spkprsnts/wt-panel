package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"wtpanel/internal/models"
)

func (s *Server) createProfile(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}

	var req ProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	coreType := models.CoreType(req.CoreType)
	prov, err := s.registry.For(coreType)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Append after every existing profile; a raw count would collide once SortOrder has gaps from deletions.
	var maxOrder int
	if err := s.db.Model(&models.Profile{}).
		Where("client_id = ?", client.ID).
		Select("COALESCE(MAX(sort_order), -1)").
		Scan(&maxOrder).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	profile := models.Profile{
		ClientID:            client.ID,
		ExternalID:          uuid.New().String(),
		Name:                req.Name,
		CoreType:            coreType,
		SortOrder:           maxOrder + 1,
		CoreConfig:          string(req.CoreConfig),
		Enabled:             true,
		XrayEnabled:         req.XrayEnabled,
		XrayInboundID:       req.XrayInboundID,
		XrayManualURI:       req.XrayManualURI,
		XrayManualWireGuard: req.XrayManualWireGuard,
		XrayDualRoute:       req.XrayDualRoute,
		XrayDirectAddress:   req.XrayDirectAddress,
		XrayHcInterval:      req.XrayHcInterval,
		XrayMux:             req.XrayMux,
	}
	if req.Enabled != nil {
		profile.Enabled = *req.Enabled
	}

	// Insert first so profile.ID is the real database id before AddProfile runs — provisioners key
	// their process-supervisor map by profile.ID, so a zero ID would orphan the process: RemoveProfile
	// would never find it to stop it.
	if err := s.db.Create(&profile).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if req.XrayEnabled && req.XrayInboundID != nil {
		if err := s.attachProfileToInbound(&profile, *req.XrayInboundID, client); err != nil {
			s.db.Delete(&profile)
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		s.reloadXray(c)
	}

	uri, err := prov.AddProfile(c.Request.Context(), &profile)
	if err != nil {
		s.db.Delete(&profile) // provisioning failed — don't leave an unprovisioned stub around
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provisioning failed: " + err.Error()})
		return
	}
	profile.KernelURI = uri

	if err := s.db.Save(&profile).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// AddProfile always fully provisions and starts the process; a profile created disabled just gets
	// stopped again immediately, rather than adding a "provision but don't start" mode to every
	// provisioner. Best-effort, like teardownProfile.
	if !profile.Enabled {
		if err := s.registry.Stop(&profile); err != nil {
			c.Error(err)
		}
	}
	s.registry.FillStatus(&profile)
	c.JSON(http.StatusCreated, profile)
}

// updateProfile applies logical changes (name, xray overlay, per-core fields); infra fields
// (ports, generated secrets) are preserved by the provisioner itself — see provisioner/common's
// "UpdateProfile" contract.
func (s *Server) updateProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	var req ProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.CoreType != "" && models.CoreType(req.CoreType) != profile.CoreType {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change a profile's core type — delete and recreate it instead"})
		return
	}

	prov, err := s.registry.For(profile.CoreType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var client models.Client
	if err := s.db.First(&client, profile.ClientID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	profile.Name = req.Name
	if req.Enabled != nil {
		profile.Enabled = *req.Enabled
	}
	profile.XrayEnabled = req.XrayEnabled
	profile.XrayInboundID = req.XrayInboundID
	profile.XrayManualURI = req.XrayManualURI
	profile.XrayManualWireGuard = req.XrayManualWireGuard
	profile.XrayDualRoute = req.XrayDualRoute
	profile.XrayDirectAddress = req.XrayDirectAddress
	profile.XrayHcInterval = req.XrayHcInterval
	profile.XrayMux = req.XrayMux
	if req.XrayEnabled && req.XrayInboundID != nil {
		if err := s.attachProfileToInbound(&profile, *req.XrayInboundID, &client); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		s.reloadXray(c)
	}
	if req.CoreConfig != nil {
		profile.CoreConfig = string(req.CoreConfig)
	}

	uri, err := prov.UpdateProfile(c.Request.Context(), &profile)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "provisioning failed: " + err.Error()})
		return
	}
	profile.KernelURI = uri

	if err := s.db.Save(&profile).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// UpdateProfile above always (re)starts the process; same start-then-stop compromise as
	// createProfile for a profile that should end up disabled.
	if !profile.Enabled {
		if err := s.registry.Stop(&profile); err != nil {
			c.Error(err)
		}
	}
	s.registry.FillStatus(&profile)
	c.JSON(http.StatusOK, profile)
}

// reorderProfiles sets display order for a client's profiles from the full set of IDs (each exactly
// once), not a partial move — simpler to validate, and the frontend always computes the full order anyway.
func (s *Server) reorderProfiles(c *gin.Context) {
	client, err := s.loadClient(c)
	if err != nil {
		return
	}

	var req ReorderProfilesRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.ProfileIDs) != len(client.Profiles) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "profileIds must list every profile belonging to this client, exactly once"})
		return
	}
	belongsToClient := make(map[uint]bool, len(client.Profiles))
	for _, p := range client.Profiles {
		belongsToClient[p.ID] = true
	}
	seen := make(map[uint]bool, len(req.ProfileIDs))
	for _, id := range req.ProfileIDs {
		if !belongsToClient[id] || seen[id] {
			c.JSON(http.StatusBadRequest, gin.H{"error": "profileIds must list every profile belonging to this client, exactly once"})
			return
		}
		seen[id] = true
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		for i, id := range req.ProfileIDs {
			if err := tx.Model(&models.Profile{}).Where("id = ?", id).Update("sort_order", i).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// setProfileRecommended marks (or unmarks) one profile as its client's
// recommended pick, clearing any sibling's flag in the same transaction.
func (s *Server) setProfileRecommended(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	var req SetRecommendedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	err = s.db.Transaction(func(tx *gorm.DB) error {
		if req.Recommended {
			if err := tx.Model(&models.Profile{}).
				Where("client_id = ? AND id <> ?", profile.ClientID, profile.ID).
				Update("recommended", false).Error; err != nil {
				return err
			}
		}
		return tx.Model(&profile).Update("recommended", req.Recommended).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	profile.Recommended = req.Recommended
	s.registry.FillStatus(&profile)
	c.JSON(http.StatusOK, profile)
}

// getProfileLogs returns the tail of a profile's process log; optional ?tail=N (bytes, default
// 64KiB) avoids sending a very old/verbose log whole every time the UI opens it.
func (s *Server) getProfileLogs(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	maxBytes := 64 * 1024
	if tail := c.Query("tail"); tail != "" {
		if n, err := strconv.Atoi(tail); err == nil && n > 0 {
			maxBytes = n
		}
	}

	log, err := s.registry.Logs(&profile, maxBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	running, pid := false, 0
	if prov, err := s.registry.For(profile.CoreType); err == nil {
		running, pid = prov.Status(&profile)
	}
	c.JSON(http.StatusOK, gin.H{"log": log, "running": running, "pid": pid})
}

// restartProfile is the manual counterpart to ProcessSupervisor's automatic crash restart, for an
// operator who wants to kick a stuck process right away.
func (s *Server) restartProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	if !profile.Enabled {
		// Restart would leave the process running while the DB's Enabled column disagrees; enable via the form instead.
		c.JSON(http.StatusBadRequest, gin.H{"error": "profile is disabled — enable it first"})
		return
	}
	if err := s.registry.Restart(&profile); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	s.registry.FillStatus(&profile)
	c.JSON(http.StatusOK, profile)
}

// profileLinks is the QR-dialog data source for a single profile: the kernel's own URI
// (turnable://, freeturn://, …) alongside a self-contained wireturn:// deep link (§4).
func (s *Server) profileLinks(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	bp := s.buildBundleProfile(profile)
	wireturnLink, err := buildProfileWireturnLink(bp)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"kernelUri":    profile.KernelURI,
		"wireturnLink": wireturnLink,
	})
}

// exportProfile is the "download wt-*.json" action for a single profile — same shape as
// exportClientProfiles, a lone object instead of an array (both valid per §5.4/§5.5).
func (s *Server) exportProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}
	bp := s.buildBundleProfile(profile)
	filename := "wt_" + slugFilename(profile.Name) + ".json"
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)
	c.JSON(http.StatusOK, bp)
}

func (s *Server) deleteProfile(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid profile id"})
		return
	}
	var profile models.Profile
	if err := s.db.First(&profile, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "profile not found"})
		return
	}

	s.teardownProfile(c, &profile)

	if err := s.db.Delete(&profile).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

// teardownProfile best-effort tears down server-side state, logging failures via gin's error
// collector rather than blocking deletion of the panel-side record.
func (s *Server) teardownProfile(c *gin.Context, profile *models.Profile) {
	prov, err := s.registry.For(profile.CoreType)
	if err != nil {
		c.Error(err)
		return
	}
	if err := prov.RemoveProfile(c.Request.Context(), profile); err != nil {
		c.Error(err)
	}
}
