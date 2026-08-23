package api

import (
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/json"
)

// encodeWireturnContainer implements the wireturn:// / wt:// deep-link
// container documented in docs/subscriptions.md §4: zlib-deflate (standard
// zlib container — header + Adler-32 trailer, NOT raw deflate) at
// BestCompression, then Base64 URL-safe with padding stripped. There's no
// version byte or magic prefix — decoding is the exact mirror of this.
func encodeWireturnContainer(payload []byte) string {
	var buf bytes.Buffer
	zw, _ := zlib.NewWriterLevel(&buf, zlib.BestCompression)
	_, _ = zw.Write(payload)
	_ = zw.Close()
	return "wireturn://" + base64.RawURLEncoding.EncodeToString(buf.Bytes())
}

// buildSubscriptionWireturnLink wraps a subscription URL for one-tap import
// — per §4, the container's decompressed payload is checked for an
// "http://"/"https://" prefix to tell a subscription address apart from an
// embedded profile, so this deliberately compresses the bare URL text, not a
// JSON-quoted string.
func buildSubscriptionWireturnLink(url string) string {
	return encodeWireturnContainer([]byte(url))
}

// buildProfileWireturnLink wraps a single profile (in the same "Profile"
// JSON shape §5.4/§5.5 use) for direct, subscription-less import — the
// spec allows the container to carry either a bare Profile object or an
// array; a lone object is simpler and just as valid.
func buildProfileWireturnLink(bp BundleProfile) (string, error) {
	data, err := json.Marshal(bp)
	if err != nil {
		return "", err
	}
	return encodeWireturnContainer(data), nil
}
