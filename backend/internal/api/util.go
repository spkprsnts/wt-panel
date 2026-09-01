package api

import (
	"encoding/base64"
	"fmt"
	"strings"
)

func base64StdEncode(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

// formatBytesShort renders a byte count the way §5.5's "#used:"/"#available:"
// tags expect (e.g. "10mb", "1.5gb") — lowercase unit, no space.
func formatBytesShort(n int64) string {
	units := []string{"b", "kb", "mb", "gb", "tb"}
	v := float64(n)
	i := 0
	for v >= 1024 && i < len(units)-1 {
		v /= 1024
		i++
	}
	if v == float64(int64(v)) {
		return fmt.Sprintf("%d%s", int64(v), units[i])
	}
	return fmt.Sprintf("%.1f%s", v, units[i])
}

// slugFilename turns an arbitrary display name into a safe download filename component, used by
// every "wt_*.json" export to avoid a broken/unsafe Content-Disposition filename.
func slugFilename(name string) string {
	var b strings.Builder
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '-', r == '_':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('_')
		}
	}
	s := b.String()
	if s == "" {
		return "profile"
	}
	if len(s) > 60 {
		s = s[:60]
	}
	return s
}
