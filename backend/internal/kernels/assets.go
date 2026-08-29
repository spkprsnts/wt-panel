package kernels

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"runtime"
	"strings"
)

// assetName builds the release asset filename this host needs:
// "{prefix}-{goos}-{goarch}", with optional per-arch overrides for binaries
// whose goreleaser config uses non-standard arch suffixes.
func assetName(prefix string, archOverrides map[string]string) string {
	arch := runtime.GOARCH
	if archOverrides != nil {
		if mapped, ok := archOverrides[arch]; ok {
			arch = mapped
		}
	}
	return fmt.Sprintf("%s-%s-%s", prefix, runtime.GOOS, arch)
}

// TurnableAssetName returns e.g. "turnable-linux-amd64" for this host.
func TurnableAssetName() string {
	return assetName("turnable", nil)
}

// FreeTurnAssetName returns e.g. "server-linux-amd64" for this host.
// FreeTurn's goreleaser config names 32-bit ARM "armv7" and softfloat MIPS
// variants with a "-softfloat" suffix.
func FreeTurnAssetName() string {
	return assetName("server", map[string]string{
		"arm":      "armv7",
		"mips":     "mips-softfloat",
		"mipsle":   "mipsle-softfloat",
		"mips64le": "mips64le-softfloat",
	})
}

// XrayAssetName returns e.g. "Xray-linux-64.zip" for this host — Xray-core
// publishes one zip per platform, named "Xray-{os}-{arch}.zip" with its own
// arch spelling ("64"/"32" not "amd64"/"386", "arm64-v8a" not "arm64").
// Linux only (see README). An unsupported architecture returns "" rather
// than guessing.
func XrayAssetName() string {
	if runtime.GOOS != "linux" {
		return ""
	}
	var archName string
	switch runtime.GOARCH {
	case "amd64":
		archName = "64"
	case "386":
		archName = "32"
	case "arm64":
		archName = "arm64-v8a"
	case "arm":
		archName = "arm32-v7a"
	default:
		return ""
	}
	return fmt.Sprintf("Xray-linux-%s.zip", archName)
}

// XrayZipEntryName is the binary's name inside XrayAssetName()'s archive.
func XrayZipEntryName() string {
	return "xray"
}

// WebDAVAssetSuffix returns e.g. "-linux-amd64.tar.gz" for this host.
// webdav-tunnel's goreleaser config bakes the version into the asset
// filename itself (webdav-tunnel-X.Y.Z-linux-amd64.tar.gz), so there's no
// fixed exact name to look for ahead of resolving which release this is —
// this returns only the platform-specific tail, matched via
// FindAssetBySuffix rather than FindAsset. Linux only, like XrayAssetName.
func WebDAVAssetSuffix() string {
	if runtime.GOOS != "linux" {
		return ""
	}
	switch runtime.GOARCH {
	case "amd64", "arm64":
		return fmt.Sprintf("-linux-%s.tar.gz", runtime.GOARCH)
	default:
		return ""
	}
}

// WebDAVTarEntryName is the binary's name inside a WebDAVAssetSuffix()
// archive — sits at the archive root alongside LICENSE/README/docs/.
func WebDAVTarEntryName() string {
	return "webdav-tunnel"
}

// FindAsset returns the asset in a release matching exactly this name, or
// an error listing what a release for this platform is missing.
func FindAsset(release Release, name string) (Asset, error) {
	for _, a := range release.Assets {
		if a.Name == name {
			return a, nil
		}
	}
	return Asset{}, fmt.Errorf("release %s has no asset %q for this platform (%s/%s)",
		release.TagName, name, runtime.GOOS, runtime.GOARCH)
}

// FindAssetBySuffix is FindAsset's counterpart for releases (webdav-tunnel)
// that bake their version into the asset filename itself, so an exact name
// can't be known ahead of resolving which release this is.
func FindAssetBySuffix(release Release, suffix string) (Asset, error) {
	for _, a := range release.Assets {
		if strings.HasSuffix(a.Name, suffix) {
			return a, nil
		}
	}
	return Asset{}, fmt.Errorf("release %s has no asset ending in %q for this platform (%s/%s)",
		release.TagName, suffix, runtime.GOOS, runtime.GOARCH)
}

// DownloadBinary fetches url and writes it to destPath as an executable
// file, replacing anything already there. Writes to a temp file and renames
// into place, so an already-running process started from the old file keeps
// its old inode open and is unaffected — only processes started after the
// swap see the new binary.
func DownloadBinary(url, destPath string) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("download %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download %s: status %d", url, resp.StatusCode)
	}

	tmp := destPath + ".download"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmp)
		return fmt.Errorf("write %s: %w", destPath, err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Chmod(tmp, 0o755); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, destPath)
}
