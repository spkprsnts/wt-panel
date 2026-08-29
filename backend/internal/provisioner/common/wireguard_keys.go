package common

import (
	"crypto/rand"
	"encoding/base64"

	"golang.org/x/crypto/curve25519"
)

// GenerateWireGuardKeypair returns a standard WireGuard keypair (base64,
// 32 raw bytes each) — the same X25519 curve `wg genkey`/`wg pubkey` and
// Xray-core's WireGuard inbound/outbound use. No external binary involved
// (unlike Turnable's ML-KEM-768 keypair).
func GenerateWireGuardKeypair() (privateKey, publicKey string, err error) {
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		return "", "", err
	}
	// Clamp per RFC 7748 / the WireGuard spec.
	priv[0] &= 248
	priv[31] &= 127
	priv[31] |= 64

	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		return "", "", err
	}

	return base64.StdEncoding.EncodeToString(priv[:]), base64.StdEncoding.EncodeToString(pub), nil
}

// GenerateRealityKeypair returns an X25519 keypair encoded the way
// xray-core's `xray x25519` tool and Reality's privateKey/shortIds settings
// expect: raw URL-safe base64, no padding — same curve as
// GenerateWireGuardKeypair, different text encoding, so the two never
// round-trip as interchangeable strings.
func GenerateRealityKeypair() (privateKey, publicKey string, err error) {
	var priv [32]byte
	if _, err := rand.Read(priv[:]); err != nil {
		return "", "", err
	}
	priv[0] &= 248
	priv[31] &= 127
	priv[31] |= 64

	pub, err := curve25519.X25519(priv[:], curve25519.Basepoint)
	if err != nil {
		return "", "", err
	}

	return base64.RawURLEncoding.EncodeToString(priv[:]), base64.RawURLEncoding.EncodeToString(pub), nil
}
