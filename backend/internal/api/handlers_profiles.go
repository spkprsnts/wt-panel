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

	// New profiles append after every existing one for this client, rather
	// than a raw count (which would collide if profiles were ever deleted
	// and SortOrder now has gaps).
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

	// Insert first so profile.ID is the real, permanent database id before
	// AddProfile ever runs — every provisioner keys its process-supervisor
	// map by profile.ID, and that map entry has to be findable by every
	// later Status/Logs/UpdateProfile/RemoveProfile call. Provisioning
	// against a zero ID (the zero-value before Create assigns one) would
	// store the supervisor under a key nothing ever looks up again —
	// RemoveProfile in particular would then silently fail to find and
	// stop the process, orphaning it.
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
	// AddProfile always fully provisions AND starts the process (port/keys
	// have to be allocated regardless of Enabled, so the profile has real
	// state to restore later) — a profile created disabled just gets
	// stopped again immediately after, rather than teaching every
	// provisioner a separate "provision but don't start" mode. Best-effort:
	// a failure here shouldn't fail profile creation, matching
	// teardownProfile's own error-collection convention.
	if !profile.Enabled {
		if err := s.registry.Stop(&profile); err != nil {
			c.Error(err)
		}
	}
	s.registry.FillStatus(&profile)
	c.JSON(http.StatusCreated, profile)
}

// updateProfile applies logical changes (name, xray overlay, per-core
// logical fields like call_id/room_id/peers/transport). Infra fields
// (ports, generated secrets) are preserved by the provisioner itself —
// see the "UpdateProfile" contract in provisioner/common — and because
// every kernel here runs one process per profile, this never disturbs any
// other profile's connection.
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
	// UpdateProfile above always (re)starts the process to apply whatever
	// infra-relevant fields changed — same "start it, then immediately stop
	// it back" compromise as createProfile for a profile that should end up
	// disabled, rather than adding a second "update but don't start"
	// codepath to every provisioner.
	if !profile.Enabled {
		if err := s.registry.Stop(&profile); err != nil {
			c.Error(err)
		}
	}
	s.registry.FillStatus(&profile)
	c.JSON(http.StatusOK, profile)
}

// reorderProfiles sets the display order of every profile belonging to one
// client at once. Requires the full current set of that client's profile
// IDs, each exactly once, rather than a partial move — simpler to validate
// than a single-item move-up/move-down, and the frontend always computes
// the full new order locally before sending it anyway. This order isn't
// just cosmetic: see models.Profile.SortOrder's doc comment.
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
// recommended pick. Marking one clears every sibling profile's flag in the
// same transaction, since at most one can be recommended per client — see
// models.Profile.Recommended.
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

// getProfileLogs returns the tail of a profile's process log. Accepts an
// optional ?tail=N query param (bytes, default 64KiB) so a very old/verbose
// log doesn't get sent whole every time the UI opens it.
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

// restartProfile is the manual counterpart to the automatic crash restart
// ProcessSupervisor now does on its own — for an operator who wants to
// kick a stuck/misbehaving process right away instead of waiting for it to
// crash, or after fixing something out-of-band (e.g. a route the profile
// depends on).
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
		// Restart always leaves the process running, which would silently
		// bring a disabled profile back to life without the DB's Enabled
		// column agreeing — turn it on via the profile form instead, which
		// keeps the two in sync.
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

// profileLinks is the admin panel's QR-dialog data source for a single
// profile: the kernel's own documented URI (turnable://, freeturn://, …)
// alongside a wireturn:// deep link wrapping just this one profile — a
// subscription-less, self-contained import (§4).
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

// exportProfile is the admin panel's "скачать wt-*.json" action for a
// single profile — the same Profile JSON shape as exportClientProfiles,
// just a lone object instead of an array (both are valid per §5.4/§5.5).
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

// teardownProfile best-effort tears down server-side state; a provisioning
// error here shouldn't block deleting the panel-side record, so it's logged
// via gin's error collector rather than aborting the request.
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
