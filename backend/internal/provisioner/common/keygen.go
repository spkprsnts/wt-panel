package common

import (
	"crypto/rand"
	"encoding/hex"
)

// RandomHexKey generates n random bytes and hex-encodes them (2n hex
// chars). Used for olcRTC's crypto.key and FreeTurn's -obf-key, both of
// which are plain shared secrets (unlike Turnable's ML-KEM-768 keypair,
// which needs the real 'turnable config keygen' — see provisioner/turnable).
func RandomHexKey(n int) (string, error) {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
