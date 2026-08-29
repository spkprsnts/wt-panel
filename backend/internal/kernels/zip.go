package kernels

import (
	"archive/zip"
	"fmt"
	"io"
	"net/http"
	"os"
)

// DownloadZipEntry fetches a zip file from url and extracts exactly one
// entry from it to destPath as an executable file — for releases (Xray-core)
// that ship a zip archive instead of a bare binary (see DownloadBinary).
func DownloadZipEntry(url, entryName, destPath string) error {
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

	tmpZip := destPath + ".zip.download"
	zf, err := os.OpenFile(tmpZip, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(zf, resp.Body); err != nil {
		zf.Close()
		os.Remove(tmpZip)
		return fmt.Errorf("write temp zip: %w", err)
	}
	zf.Close()
	defer os.Remove(tmpZip)

	r, err := zip.OpenReader(tmpZip)
	if err != nil {
		return fmt.Errorf("open downloaded zip: %w", err)
	}
	defer r.Close()

	var entry *zip.File
	for _, f := range r.File {
		if f.Name == entryName {
			entry = f
			break
		}
	}
	if entry == nil {
		names := make([]string, 0, len(r.File))
		for _, f := range r.File {
			names = append(names, f.Name)
		}
		return fmt.Errorf("zip has no entry %q (has: %v)", entryName, names)
	}

	src, err := entry.Open()
	if err != nil {
		return fmt.Errorf("open zip entry %q: %w", entryName, err)
	}
	defer src.Close()

	tmpBin := destPath + ".download"
	out, err := os.OpenFile(tmpBin, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, src); err != nil {
		out.Close()
		os.Remove(tmpBin)
		return fmt.Errorf("extract %q: %w", entryName, err)
	}
	if err := out.Close(); err != nil {
		os.Remove(tmpBin)
		return err
	}
	if err := os.Chmod(tmpBin, 0o755); err != nil {
		os.Remove(tmpBin)
		return err
	}
	return os.Rename(tmpBin, destPath)
}
