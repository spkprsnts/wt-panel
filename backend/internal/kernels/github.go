// Package kernels manages the on-disk binaries the four provisioner
// packages shell out to: fetching pre-built releases for Turnable/FreeTurn
// (GitHub Releases, one asset per platform) and building olcRTC from source
// at a chosen commit (no releases upstream, no version tagging at all).
package kernels

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sync"
	"time"
)

// httpClient is shared by every outbound request this package makes so
// WTP_GITHUB_PROXY applies uniformly everywhere — a narrower, explicit
// override for GitHub access specifically, without exporting a system-wide
// HTTP_PROXY that would also redirect unrelated traffic.
var httpClient = buildHTTPClient()

func buildHTTPClient() *http.Client {
	proxyFunc := http.ProxyFromEnvironment
	if raw := os.Getenv("WTP_GITHUB_PROXY"); raw != "" {
		if proxyURL, err := url.Parse(raw); err == nil {
			proxyFunc = http.ProxyURL(proxyURL)
		} else {
			log.Printf("kernels: invalid WTP_GITHUB_PROXY %q: %v", raw, err)
		}
	}
	return &http.Client{Transport: &http.Transport{Proxy: proxyFunc}}
}

// Release mirrors the subset of GitHub's release JSON this package needs.
type Release struct {
	TagName     string    `json:"tag_name"`
	Name        string    `json:"name"`
	PublishedAt time.Time `json:"published_at"`
	Prerelease  bool      `json:"prerelease"`
	Assets      []Asset   `json:"assets"`
}

type Asset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
	Size               int64  `json:"size"`
}

// Commit mirrors the subset of GitHub's commit-list JSON this package needs.
type Commit struct {
	SHA    string `json:"sha"`
	Commit struct {
		Message string `json:"message"`
		Author  struct {
			Name string    `json:"name"`
			Date time.Time `json:"date"`
		} `json:"author"`
	} `json:"commit"`
}

func githubGet(path string, out interface{}) error {
	req, err := http.NewRequest(http.MethodGet, "https://api.github.com"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	if token := os.Getenv("WTP_GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("github api request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("github api %s: status %d: %s", path, resp.StatusCode, body)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

// listCacheTTL controls how long a successful releases/commits fetch is
// reused before a normal (non-forced) call hits GitHub again. GitHub's REST
// API rate limit (60/hour unauthenticated — see WTP_GITHUB_TOKEN) is shared
// across every owner/repo this panel queries, so a page reload — or several
// operators' pages open at once — shouldn't each cost a fresh request.
const listCacheTTL = 10 * time.Minute

type cacheEntry[T any] struct {
	data      T
	fetchedAt time.Time
}

// listCache is a tiny generic TTL cache shared by ListReleases and
// ListCommits. It fails open toward availability over freshness: if a
// forced or expired-cache refresh fails (e.g. hits the rate limit this
// cache exists to avoid), the previous successful fetch — however old — is
// returned instead of an error. Only errors if nothing was ever fetched
// successfully for that key.
type listCache[T any] struct {
	mu      sync.Mutex
	entries map[string]cacheEntry[T]
}

func newListCache[T any]() *listCache[T] {
	return &listCache[T]{entries: make(map[string]cacheEntry[T])}
}

func (c *listCache[T]) get(key string, force bool, fetch func() (T, error)) (T, error) {
	c.mu.Lock()
	prev, hasPrev := c.entries[key]
	fresh := hasPrev && time.Since(prev.fetchedAt) < listCacheTTL
	c.mu.Unlock()
	if fresh && !force {
		return prev.data, nil
	}

	data, err := fetch()
	if err != nil {
		if hasPrev {
			log.Printf("kernels: refreshing %s failed (%v) — serving cached list from %s", key, err, prev.fetchedAt)
			return prev.data, nil
		}
		var zero T
		return zero, err
	}

	c.mu.Lock()
	c.entries[key] = cacheEntry[T]{data: data, fetchedAt: time.Now()}
	c.mu.Unlock()
	return data, nil
}

var (
	releaseCache = newListCache[[]Release]()
	commitCache  = newListCache[[]Commit]()
)

// ListReleases returns up to `limit` most recent releases for owner/repo,
// serving a cached copy (see listCacheTTL) unless force is set — the
// Kernels page's "обновить список" button sets it; InstallRelease always
// passes false so an install doesn't also force a fresh fetch.
func ListReleases(owner, repo string, limit int, force bool) ([]Release, error) {
	key := fmt.Sprintf("%s/%s:%d", owner, repo, limit)
	return releaseCache.get(key, force, func() ([]Release, error) {
		var releases []Release
		path := fmt.Sprintf("/repos/%s/%s/releases?per_page=%d", owner, repo, limit)
		if err := githubGet(path, &releases); err != nil {
			return nil, err
		}
		return releases, nil
	})
}

// ListCommits returns up to `limit` most recent commits on the repo's
// default branch — same caching behavior as ListReleases.
func ListCommits(owner, repo string, limit int, force bool) ([]Commit, error) {
	key := fmt.Sprintf("%s/%s:%d", owner, repo, limit)
	return commitCache.get(key, force, func() ([]Commit, error) {
		var commits []Commit
		path := fmt.Sprintf("/repos/%s/%s/commits?per_page=%d", owner, repo, limit)
		if err := githubGet(path, &commits); err != nil {
			return nil, err
		}
		return commits, nil
	})
}
