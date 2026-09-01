package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/models"
)

type CallRoomRequest struct {
	Provider string `json:"provider" binding:"required"`
	RoomID   string `json:"roomId" binding:"required"`
	Label    string `json:"label"`
	Notes    string `json:"notes"`
}

// listCallRooms optionally filters by ?provider=vk, used by the create-profile dialog.
func (s *Server) listCallRooms(c *gin.Context) {
	q := s.db.Order("updated_at desc")
	if provider := c.Query("provider"); provider != "" {
		q = q.Where("provider = ?", provider)
	}
	var rooms []models.CallRoom
	if err := q.Find(&rooms).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rooms)
}

func (s *Server) createCallRoom(c *gin.Context) {
	var req CallRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	room := models.CallRoom{Provider: req.Provider, RoomID: req.RoomID, Label: req.Label, Notes: req.Notes}
	if err := s.db.Create(&room).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, room)
}

func (s *Server) updateCallRoom(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid room id"})
		return
	}
	var room models.CallRoom
	if err := s.db.First(&room, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "room not found"})
		return
	}
	var req CallRoomRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	room.Provider = req.Provider
	room.RoomID = req.RoomID
	room.Label = req.Label
	room.Notes = req.Notes
	if err := s.db.Save(&room).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, room)
}

func (s *Server) deleteCallRoom(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid room id"})
		return
	}
	if err := s.db.Delete(&models.CallRoom{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}
