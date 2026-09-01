package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/url"
	"strings"
	"time"
)

// TOTP (RFC 6238, on top of HOTP/RFC 4226) implemented directly against the stdlib rather than
// pulling in a library, same reasoning as provisioner/common's WireGuard/Reality keygen: small
// algorithm, one less dependency to trust.
const (
	totpDigits = 6
	totpPeriod = 30 * time.Second
	// totpSkew tolerates one 30s step before/after current, since the admin's phone clock and this
	// server's are never perfectly in sync.
	totpSkew = 1
)

// GenerateTOTPSecret returns a fresh base32-encoded (no padding, the convention every authenticator
// app expects) random secret: 20 bytes/160 bits, RFC 4226's recommended size for HMAC-SHA1.
func GenerateTOTPSecret() (string, error) {
	b := make([]byte, 20)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

// totpCodeAt computes the 6-digit code for secret at 30-second step
// `counter` — HOTP keyed by the step number instead of an incrementing
// counter, per RFC 6238 §1.2.
func totpCodeAt(secret string, counter uint64) (string, error) {
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if err != nil {
		return "", err
	}
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)
	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset]&0x7f) << 24) | (uint32(sum[offset+1]) << 16) | (uint32(sum[offset+2]) << 8) | uint32(sum[offset+3])
	code %= 1_000_000 // truncate to totpDigits=6 decimal digits, per RFC 4226 §5.3
	return fmt.Sprintf("%0*d", totpDigits, code), nil
}

// ValidateTOTPCode reports whether code is a valid current (±totpSkew
// steps) TOTP code for secret.
func ValidateTOTPCode(secret, code string) bool {
	code = strings.TrimSpace(code)
	if len(code) != totpDigits {
		return false
	}
	now := uint64(time.Now().Unix()) / uint64(totpPeriod.Seconds())
	for skew := -totpSkew; skew <= totpSkew; skew++ {
		var counter uint64
		if skew < 0 {
			d := uint64(-skew)
			if d > now {
				continue
			}
			counter = now - d
		} else {
			counter = now + uint64(skew)
		}
		want, err := totpCodeAt(secret, counter)
		if err != nil {
			return false
		}
		if hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

// BuildTOTPURI builds the otpauth:// provisioning URI an authenticator app scans (as a QR code) to
// add this account — the de-facto "Key URI Format" every app supports, despite never being formalized.
func BuildTOTPURI(issuer, accountName, secret string) string {
	label := url.PathEscape(issuer) + ":" + url.PathEscape(accountName)
	q := url.Values{
		"secret":    {secret},
		"issuer":    {issuer},
		"algorithm": {"SHA1"},
		"digits":    {"6"},
		"period":    {"30"},
	}
	return "otpauth://totp/" + label + "?" + q.Encode()
}
