package api

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
)

// encodeWireturnContainer implements the wireturn:// deep-link container from §4: standard zlib
// (header + Adler-32 trailer, not raw deflate) at BestCompression, then Base64 URL-safe with padding
// stripped. No version byte or magic prefix — decoding is the exact mirror.
func encodeWireturnContainer(payload []byte) string {
	var buf bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&buf, zlib.BestCompression)
	_, _ = zw.Write(payload)
	_ = zw.Close()
	return "wireturn://" + base64.RawURLEncoding.EncodeToString(buf.Bytes())
}

// buildSubscriptionWireturnLink wraps a subscription URL for one-tap import — per §4 the app checks
// the decompressed payload for an "http://"/"https://" prefix to tell it apart from an embedded
// profile, so this compresses the bare URL text, not a JSON-quoted string.
func buildSubscriptionWireturnLink(url string) string {
	return encodeWireturnContainer([]byte(url))
}

// buildProfileWireturnLink wraps a single profile (§5.4/§5.5 "Profile" shape) for direct,
// subscription-less import — the spec allows either a bare Profile object or an array here.
func buildProfileWireturnLink(bp BundleProfile) (string, error) {
	data, err := json.Marshal(bp)
	if err != nil {
		return "", err
	}
	return encodeWireturnContainer(data), nil
}
