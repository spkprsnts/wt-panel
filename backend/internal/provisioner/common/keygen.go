package common

import (
	"crypto/rand"
	"encoding/hex"
)

// RandomHexKey generates n random bytes, hex-encoded (2n chars) — for
// olcRTC's crypto.key / FreeTurn's -obf-key, plain shared secrets (unlike
// Turnable's ML-KEM-768 keypair, see provisioner/turnable).
func RandomHexKey(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
