package kernels

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
)

// DownloadTarGzEntry fetches a gzip-compressed tar file from url and
// extracts exactly one entry from it to destPath as an executable file —
// webdav-tunnel's goreleaser-produced releases ship this way (binary
// alongside LICENSE/README/docs/), unlike Turnable/FreeTurn's raw-binary
// assets (see DownloadBinary) or Xray-core's zip (see DownloadZipEntry).
func DownloadTarGzEntry(url, entryName, destPath string) error {
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

	gz, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("open gzip stream: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			return fmt.Errorf("tar has no entry %q", entryName)
		}
		if err != nil {
			return fmt.Errorf("read tar: %w", err)
		}
		if hdr.Name != entryName || hdr.Typeflag != tar.TypeReg {
			continue
		}

		tmp := destPath + ".download"
		out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, tr); err != nil {
			out.Close()
			os.Remove(tmp)
			return fmt.Errorf("extract %q: %w", entryName, err)
		}
		if err := out.Close(); err != nil {
			os.Remove(tmp)
			return err
		}
		if err := os.Chmod(tmp, 0o755); err != nil {
			os.Remove(tmp)
			return err
		}
		return os.Rename(tmp, destPath)
	}
}
