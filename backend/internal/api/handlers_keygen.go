package api

import (
	"math/rand/v2"
	"net/http"

	"github.com/gin-gonic/gin"

	"wtpanel/internal/provisioner/common"
	"wtpanel/internal/provisioner/turnable"
)

// keygenTurnable shells out to the Turnable binary's own keygen (ML-KEM-768, no pure-Go
// implementation here) so the profile form's "Generate" button works without VPS shell access.
func (s *Server) keygenTurnable(c *gin.Context) {
	pub, priv, err := turnable.Keygen(c.Request.Context(), s.cfg.TurnableBinPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"pubKey": pub, "privKey": priv})
}

// keygenHex32 generates a plain 32-byte hex key, used for olcRTC's crypto.key and FreeTurn's
// -obf-key — ordinary shared secrets, unlike Turnable's keypair.
func (s *Server) keygenHex32(c *gin.Context) {
	key, err := common.RandomHexKey(32)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"key": key})
}

// keygenWireGuard generates a standard WireGuard X25519 keypair for the Xray page's WireGuard
// inbound form — pure Go, no external binary.
func (s *Server) keygenWireGuard(c *gin.Context) {
	priv, pub, err := common.GenerateWireGuardKeypair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"privateKey": priv, "publicKey": pub})
}

// keygenReality generates an X25519 keypair for Reality's privateKey/publicKey settings (raw
// URL-safe base64 — can't reuse keygenWireGuard's output as-is, see common.GenerateRealityKeypair).
func (s *Server) keygenReality(c *gin.Context) {
	priv, pub, err := common.GenerateRealityKeypair()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"privateKey": priv, "publicKey": pub})
}

// keygenShortIds generates Reality shortId candidates for realitySettings.shortIds: one id at each
// valid byte length 1-8 (0 bytes is the wildcard "match any" value, not a candidate to hand out), in
// random order. RandomHexKey supplies the real randomness; math/rand/v2 only shuffles order.
func (s *Server) keygenShortIds(c *gin.Context) {
	ids := make([]string, 8)
	for i := range ids {
		id, err := common.RandomHexKey(i + 1)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		ids[i] = id
	}
	rand.Shuffle(len(ids), func(i, j int) { ids[i], ids[j] = ids[j], ids[i] })
	c.JSON(http.StatusOK, gin.H{"shortIds": ids})
}
