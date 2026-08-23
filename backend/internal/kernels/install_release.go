package kernels

import "fmt"

// InstallRelease downloads the given release's asset for this host's
// platform and installs it at destPath. version is a release tag (e.g.
// "0.5.3" or "v3.1.1") — pass "" to install the latest release instead.
func InstallRelease(owner, repo, version, assetName, destPath string) (installedVersion string, err error) {
	// force=false: reuse whatever the Kernels page's own listing already
	// cached rather than spending another GitHub API call just because an
	// install happens to be starting right now.
	releases, err := ListReleases(owner, repo, 100, false)
	if err != nil {
		return "", err
	}
	if len(releases) == 0 {
		return "", fmt.Errorf("%s/%s has no releases", owner, repo)
	}

	var target *Release
	if version == "" {
		for i := range releases {
			if !releases[i].Prerelease {
				target = &releases[i]
				break
			}
		}
		if target == nil {
			target = &releases[0]
		}
	} else {
		for i := range releases {
			if releases[i].TagName == version {
				target = &releases[i]
				break
			}
		}
	}
	if target == nil {
		return "", fmt.Errorf("%s/%s has no release tagged %q", owner, repo, version)
	}

	asset, err := FindAsset(*target, assetName)
	if err != nil {
		return "", err
	}
	if err := DownloadBinary(asset.BrowserDownloadURL, destPath); err != nil {
		return "", err
	}
	return target.TagName, nil
}

// InstallReleaseZipEntry is InstallRelease's counterpart for releases that
// ship a zip archive instead of a bare binary (Xray-core) — otherwise
// identical version-resolution logic, just extracting one named entry from
// the downloaded archive instead of writing the download straight through.
func InstallReleaseZipEntry(owner, repo, version, assetName, entryName, destPath string) (installedVersion string, err error) {
	// force=false: reuse whatever the Kernels page's own listing already
	// cached rather than spending another GitHub API call just because an
	// install happens to be starting right now.
	releases, err := ListReleases(owner, repo, 100, false)
	if err != nil {
		return "", err
	}
	if len(releases) == 0 {
		return "", fmt.Errorf("%s/%s has no releases", owner, repo)
	}

	var target *Release
	if version == "" {
		for i := range releases {
			if !releases[i].Prerelease {
				target = &releases[i]
				break
			}
		}
		if target == nil {
			target = &releases[0]
		}
	} else {
		for i := range releases {
			if releases[i].TagName == version {
				target = &releases[i]
				break
			}
		}
	}
	if target == nil {
		return "", fmt.Errorf("%s/%s has no release tagged %q", owner, repo, version)
	}

	asset, err := FindAsset(*target, assetName)
	if err != nil {
		return "", err
	}
	if err := DownloadZipEntry(asset.BrowserDownloadURL, entryName, destPath); err != nil {
		return "", err
	}
	return target.TagName, nil
}

// InstallReleaseTarGzEntry is InstallRelease's counterpart for releases
// (webdav-tunnel) that ship a gzip-compressed tar archive whose asset
// filename bakes in the version, so the asset is matched by a
// platform-specific suffix (FindAssetBySuffix) rather than the exact name
// InstallRelease/InstallReleaseZipEntry look for.
func InstallReleaseTarGzEntry(owner, repo, version, assetSuffix, entryName, destPath string) (installedVersion string, err error) {
	// force=false: reuse whatever the Kernels page's own listing already
	// cached rather than spending another GitHub API call just because an
	// install happens to be starting right now.
	releases, err := ListReleases(owner, repo, 100, false)
	if err != nil {
		return "", err
	}
	if len(releases) == 0 {
		return "", fmt.Errorf("%s/%s has no releases", owner, repo)
	}

	var target *Release
	if version == "" {
		for i := range releases {
			if !releases[i].Prerelease {
				target = &releases[i]
				break
			}
		}
		if target == nil {
			target = &releases[0]
		}
	} else {
		for i := range releases {
			if releases[i].TagName == version {
				target = &releases[i]
				break
			}
		}
	}
	if target == nil {
		return "", fmt.Errorf("%s/%s has no release tagged %q", owner, repo, version)
	}

	asset, err := FindAssetBySuffix(*target, assetSuffix)
	if err != nil {
		return "", err
	}
	if err := DownloadTarGzEntry(asset.BrowserDownloadURL, entryName, destPath); err != nil {
		return "", err
	}
	return target.TagName, nil
}
