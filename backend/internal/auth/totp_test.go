package auth

import (
	"encoding/base32"
	"testing"
	"time"
)

// TestTotpCodeAtRFC6238Vector checks totpCodeAt against RFC 6238 Appendix B's published SHA1 vector:
// key "12345678901234567890" at T=59s (counter=1) produces 8-digit code 94287082; this package's
// 6-digit truncation is exactly its last 6 digits.
func TestTotpCodeAtRFC6238Vector(t *testing.T) {
	rawKey := "12345678901234567890"
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString([]byte(rawKey))

	got, err := totpCodeAt(secret, 1)
	if err != nil {
		t.Fatalf("totpCodeAt: %v", err)
	}
	if want := "287082"; got != want {
		t.Errorf("totpCodeAt(counter=1) = %q, want %q", got, want)
	}
}

func TestValidateTOTPCodeRoundTrip(t *testing.T) {
	secret, err := GenerateTOTPSecret()
	if err != nil {
		t.Fatalf("GenerateTOTPSecret: %v", err)
	}
	// Matches what ValidateTOTPCode computes internally, so the code lands in the same 30s step.
	now := uint64(time.Now().Unix()) / uint64(totpPeriod.Seconds())
	code, err := totpCodeAt(secret, now)
	if err != nil {
		t.Fatalf("totpCodeAt: %v", err)
	}
	if !ValidateTOTPCode(secret, code) {
		t.Error("ValidateTOTPCode rejected a code generated for the current step")
	}
	if ValidateTOTPCode(secret, "000000") && code != "000000" {
		t.Error("ValidateTOTPCode accepted an unrelated code")
	}
}
