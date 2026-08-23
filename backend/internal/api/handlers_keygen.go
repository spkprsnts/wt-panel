package api

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/provisioner/common"
	"wtpanel/internal/provisioner/turnable"
)

// keygenTurnable shells out to the Turnable binary's own keygen (ML-KEM-768
// — there's no pure-Go implementation in this codebase) so the "Generate"
// button in the create/edit profile form can fill pub_key/priv_key without
// the operator needing a shell on the VPS.
func (s *Server) keygenTurnable(c *gin.Context) {
	pub, priv, err := turnable.Keygen(c.Request.Context(), s.cfg.TurnableBinPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"pubKey": pub, "privKey": priv})
}

// keygenHex32 generates a plain 32-byte hex key — used for both olcRTC's
// crypto.key and FreeTurn's -obf-key, which are ordinary shared secrets
// (unlike Turnable's keypair, these don't need the binary itself).
func (s *Server) keygenHex32(c *gin.Context) {
	key, err := common.RandomHexKey(32)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key})
}

// keygenWireGuard generates a standard WireGuard X25519 keypair for the
// Xray page's WireGuard inbound form — pure Go, no external binary (unlike
// Turnable's keygen).
func (s *Server) keygenWireGuard(c *gin.Context) {
	priv, pub, err := common.GenerateWireGuardKeypair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"privateKey": priv, "publicKey": pub})
}

// keygenReality generates an X25519 keypair encoded for Reality's
// privateKey/publicKey settings (raw URL-safe base64 — see
// common.GenerateRealityKeypair for why this can't reuse keygenWireGuard's
// output as-is).
func (s *Server) keygenReality(c *gin.Context) {
	priv, pub, err := common.GenerateRealityKeypair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"privateKey": priv, "publicKey": pub})
}

// keygenShortID generates one Reality shortId candidate (8 random bytes,
// 16 hex chars) — 3x-ui's UI generates several of these to fill
// realitySettings.shortIds; the operator can click "Generate" repeatedly to
// build a list.
func (s *Server) keygenShortID(c *gin.Context) {
	id, err := common.RandomHexKey(8)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"shortId": id})
}
