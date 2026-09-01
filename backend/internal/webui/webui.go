// Package webui embeds the built frontend (frontend/dist, copied here as internal/webui/dist by
// install.sh) into the backend binary, so a production deployment is a single self-contained file.
// dist/.placeholder is checked into git so `go build`/`go vet` compile even before the frontend
// build has run (go:embed fails if the pattern matches nothing).
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// DistFS returns the embedded frontend build output rooted at dist/ itself, ready to serve directly.
func DistFS() (fs.FS, error) {
	return fs.Sub(distFS, "dist")
}
