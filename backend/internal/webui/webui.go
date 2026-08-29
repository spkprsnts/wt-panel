// Package webui embeds the built frontend (frontend/dist, copied here as
// internal/webui/dist by install.sh) into the compiled backend binary
// itself, so a production deployment is a single self-contained file: no
// separate frontend host, no nginx, the Go binary serves both the API and
// the SPA. dist/.placeholder is checked into git so `go build`/`go vet`
// always compile even before anyone has run the frontend build (go:embed
// fails if the pattern matches nothing).
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// DistFS returns the embedded frontend build output rooted at dist/ itself
// (not internal/webui/dist/...), ready to serve directly.
func DistFS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
