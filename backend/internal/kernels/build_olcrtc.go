package kernels

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

// olcRTC has no releases upstream (no version tagging at all — see its own
// magefile.go), so the only way to pin a specific state is to build from
// source at a chosen commit. That's a multi-step, possibly multi-minute
// pipeline (clone + submodules + `go run mage build`), so it runs as a
// background Job the API layer can poll instead of blocking an HTTP request.
type JobStatus string

const (
	JobRunning JobStatus = "running"
	JobSuccess JobStatus = "success"
	JobFailed  JobStatus = "failed"
)

type Job struct {
	ID         string     `json:"id"`
	Kernel     string     `json:"kernel"` // "turnable" | "freeturn" | "xray" | "olcrtc"
	Ref        string     `json:"ref"`    // requested version/ref (empty = latest release)
	Status     JobStatus  `json:"status"`
	Log        string     `json:"log"`
	Version    string     `json:"version"` // resolved version/commit SHA, filled in once known
	StartedAt  time.Time  `json:"startedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}

type JobManager struct {
	mu   sync.Mutex
	jobs map[string]*Job
	// latest tracks each kernel's most recently started job id, so the API
	// layer can answer "what's going on with this kernel" by name alone
	// (see LatestJob) — the Kernels page uses this to resume showing
	// accurate progress after a full page reload, when it no longer has
	// the job id that a run-in-progress request would otherwise carry.
	latest map[string]string
}

func NewJobManager() *JobManager {
	return &JobManager{jobs: make(map[string]*Job), latest: make(map[string]string)}
}

func (m *JobManager) Get(id string) (Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	j, ok := m.jobs[id]
	if !ok {
		return Job{}, false
	}
	return *j, true // copy — caller gets a snapshot, no shared mutable state
}

// LatestJob returns the most recently started job for kernel (one of
// "turnable"/"freeturn"/"xray"/"olcrtc"), if any has run since the panel
// process started. false if this kernel has never had a job.
func (m *JobManager) LatestJob(kernel string) (Job, bool) {
	m.mu.Lock()
	id, ok := m.latest[kernel]
	m.mu.Unlock()
	if !ok {
		return Job{}, false
	}
	return m.Get(id)
}

// startJob centralizes the bookkeeping every kind of kernel job needs:
// registering it as the kernel's "latest" (for LatestJob above), and
// refusing to start a second one while an existing one for the same
// kernel is still running — without this, reloading the page mid-install
// and clicking "Установить" again would kick off a redundant concurrent
// download/build of the same thing.
func (m *JobManager) startJob(kernel, ref string) (job *Job, alreadyRunning bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.latest[kernel]; ok {
		if existing, ok2 := m.jobs[id]; ok2 && existing.Status == JobRunning {
			cp := *existing
			return &cp, true
		}
	}
	job = &Job{ID: uuid.New().String(), Kernel: kernel, Ref: ref, Status: JobRunning, StartedAt: time.Now()}
	m.jobs[job.ID] = job
	m.latest[kernel] = job.ID
	return job, false
}

func (m *JobManager) appendLog(job *Job, line string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	job.Log += line + "\n"
}

func (m *JobManager) finish(job *Job, status JobStatus, version string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	job.Status = status
	job.Version = version
	job.FinishedAt = &now
}

// StartOlcRTCBuild kicks off the build in a background goroutine and
// returns immediately with the job's id; poll Get(id) for progress.
//
// onSuccess runs from inside that same background goroutine the moment the
// build actually finishes — not from whatever HTTP request later happens to
// poll Get(id) for it. That distinction matters: a job that outlives every
// client watching it (the operator reloads the page, or never comes back
// to check) still finishes the same way, so whatever onSuccess is meant to
// record (see handlers_kernels.go's recordKernelInstall) can't get silently
// skipped just because nobody was around to observe the "success" status
// over HTTP.
func (m *JobManager) StartOlcRTCBuild(ref, destPath, dataDir string, onSuccess func(version, log string)) *Job {
	job, running := m.startJob("olcrtc", ref)
	if running {
		return job
	}
	go m.runOlcRTCBuild(job, ref, destPath, dataDir, onSuccess)
	return job
}

// StartInstall runs a release-download install (Turnable/FreeTurn/Xray-core
// — fetch a prebuilt binary, no multi-step build like olcRTC needs) as a
// background job with the same reload-safety guarantee as
// StartOlcRTCBuild: onSuccess fires from this goroutine itself the moment
// work() returns, not from whatever request later happens to poll for the
// result, so recordKernelInstall can't get silently skipped just because
// the operator reloaded the page before the download finished.
func (m *JobManager) StartInstall(kernel, ref string, work func() (version string, err error), onSuccess func(version string)) *Job {
	job, running := m.startJob(kernel, ref)
	if running {
		return job
	}
	go func() {
		version, err := work()
		if err != nil {
			m.appendLog(job, "error: "+err.Error())
			m.finish(job, JobFailed, "")
			return
		}
		m.appendLog(job, "installed version "+version)
		m.finish(job, JobSuccess, version)
		if onSuccess != nil {
			onSuccess(version)
		}
	}()
	return job
}

// ensureBuildTools makes sure git and a Go toolchain are on PATH before the
// actual clone/build steps run — a server this panel was just installed
// onto (via install.sh) may never have needed either: Turnable/FreeTurn
// install as prebuilt binaries, and the panel's own install.sh bootstraps
// git/go/node only for building the panel itself, not for whatever the
// operator later builds through this feature. A fresh box that's never
// even run `apt-get update` needs that run before any package name will
// resolve at all, so it's done here too, not assumed.
//
// git comes from apt (fine for that — nothing here depends on a specific
// git version). Go does not: apt's own golang-go package lags upstream by
// years on most distros' stable releases (confirmed while setting up this
// same box for dev — Ubuntu 24.04's apt gives Go far older than this
// repo's own go.mod requires), so a missing or already-present-but-old `go`
// gets the real upstream tarball from go.dev instead, same fix as had to
// use for Node.js earlier (apt's nodejs was too old for this project's
// frontend toolchain — see dev.sh/README).
func ensureBuildTools(run func(dir string, env []string, name string, args ...string) bool) bool {
	if _, err := exec.LookPath("git"); err != nil {
		if !run("", nil, "sh", "-c", "apt-get update -qq && apt-get install -y -qq git curl") {
			return false
		}
	}

	if _, err := exec.LookPath("go"); err != nil {
		// A previous build may have already installed it this way but this
		// process's own PATH (captured at panel startup) doesn't include it.
		if _, statErr := os.Stat("/usr/local/go/bin/go"); statErr == nil {
			os.Setenv("PATH", "/usr/local/go/bin:"+os.Getenv("PATH"))
		} else {
			arch := runtime.GOARCH // go.dev's tarball names use the same amd64/arm64 spelling as GOARCH
			script := fmt.Sprintf(`set -e
v=$(curl -fsSL "https://go.dev/VERSION?m=text" | head -1)
curl -fsSL "https://go.dev/dl/${v}.linux-%s.tar.gz" -o /tmp/wtp-go.tar.gz
rm -rf /usr/local/go
tar -C /usr/local -xzf /tmp/wtp-go.tar.gz
rm -f /tmp/wtp-go.tar.gz
ln -sf /usr/local/go/bin/go /usr/local/bin/go
ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
`, arch)
			if !run("", nil, "sh", "-c", script) {
				return false
			}
			os.Setenv("PATH", "/usr/local/go/bin:"+os.Getenv("PATH"))
		}
	}

	return ensureSwapForBuild(run)
}

// olcrtcSwapFile is dedicated to this one purpose (not a generic "/swapfile"
// like olcRTC's own docs use) so this never touches a swap file the
// operator set up themselves for unrelated reasons — we only ever create,
// check, or re-enable this exact path.
const olcrtcSwapFile = "/var/lib/wt-panel-olcrtc-build.swap"

// olcrtcBuildMemThresholdKB is olcRTC's own documented cutoff: "If you have
// less than 4 GB RAM, the build may crash" (docs/fast.md, docs/manual.md —
// go+its WebRTC/codec dependency graph is heavy enough during compilation
// to OOM on small boxes). Below it, this adds swap using the exact same
// fallocate+mkswap+swapon recipe those docs give as the fix.
const olcrtcBuildMemThresholdKB = 4 * 1024 * 1024

// ensureSwapForBuild is a no-op the moment RAM+existing swap already clears
// olcRTC's documented threshold — most boxes this panel runs on won't need
// it at all. Read failures on /proc/meminfo (i.e. not Linux, though this
// panel is Linux-only anyway — see README) fail open: better to attempt the
// build and let it fail the way it always did than to block it over a
// diagnostic that couldn't run.
func ensureSwapForBuild(run func(dir string, env []string, name string, args ...string) bool) bool {
	totalKB, swapKB, err := readMemInfoKB()
	if err != nil {
		return true
	}
	if totalKB+swapKB >= olcrtcBuildMemThresholdKB {
		return true
	}

	if _, err := os.Stat(olcrtcSwapFile); err == nil {
		// Created by an earlier build on this box — just make sure it's
		// actually active (a reboot since would have dropped it; swapon on
		// an already-active file is a harmless no-op error we can ignore).
		run("", nil, "swapon", olcrtcSwapFile)
		return true
	}

	if !run("", nil, "fallocate", "-l", "4G", olcrtcSwapFile) {
		// fallocate can fail on filesystems that don't support it (some
		// overlay/network mounts) — dd works everywhere, just slower.
		if !run("", nil, "dd", "if=/dev/zero", "of="+olcrtcSwapFile, "bs=1M", "count=4096") {
			return false
		}
	}
	return run("", nil, "chmod", "600", olcrtcSwapFile) &&
		run("", nil, "mkswap", olcrtcSwapFile) &&
		run("", nil, "swapon", olcrtcSwapFile)
}

// readMemInfoKB reads MemTotal and SwapTotal (both in kB) from
// /proc/meminfo — SwapTotal already aggregates every active swap
// file/partition, so this is simpler and just as accurate as summing
// /proc/swaps by hand.
func readMemInfoKB() (totalKB, swapKB int64, err error) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB, _ = strconv.ParseInt(fields[1], 10, 64)
		case "SwapTotal:":
			swapKB, _ = strconv.ParseInt(fields[1], 10, 64)
		}
	}
	return totalKB, swapKB, nil
}

// olcrtcGoEnv points GOPATH/GOCACHE/GOMODCACHE (and HOME, as a catch-all for
// any other tool that consults it) at a fixed directory under the panel's
// own data dir instead of leaving Go to derive them from $HOME. The panel
// normally runs as a systemd service with no User= directive, which means
// systemd never populates HOME for it — Go's "go run" then has nothing to
// derive a default module cache location from and fails outright with
// "module cache not found: neither GOMODCACHE nor GOPATH is set" (seen on a
// real fresh VPS). Anchoring it here instead of $HOME also means the module
// cache survives and gets reused across separate olcRTC builds, since tmpDir
// itself is wiped after every run.
func olcrtcGoEnv(dataDir string) []string {
	base := filepath.Join(dataDir, "olcrtc-gocache")
	gopath := filepath.Join(base, "gopath")
	return []string{
		"HOME=" + base,
		"GOPATH=" + gopath,
		"GOCACHE=" + filepath.Join(base, "gocache"),
		"GOMODCACHE=" + filepath.Join(gopath, "pkg", "mod"),
	}
}

func (m *JobManager) runOlcRTCBuild(job *Job, ref, destPath, dataDir string, onSuccess func(version, log string)) {
	tmpDir, err := os.MkdirTemp("", "olcrtc-build-*")
	if err != nil {
		m.appendLog(job, "mkdir temp dir: "+err.Error())
		m.finish(job, JobFailed, "")
		return
	}
	defer os.RemoveAll(tmpDir)

	goEnv := olcrtcGoEnv(dataDir)
	if err := os.MkdirAll(filepath.Join(dataDir, "olcrtc-gocache"), 0o755); err != nil {
		m.appendLog(job, "mkdir go cache dir: "+err.Error())
		m.finish(job, JobFailed, "")
		return
	}

	run := func(dir string, env []string, name string, args ...string) bool {
		m.appendLog(job, fmt.Sprintf("$ %s %s", name, strings.Join(args, " ")))
		cmd := exec.CommandContext(context.Background(), name, args...)
		cmd.Dir = dir
		if env != nil {
			cmd.Env = append(os.Environ(), env...)
		}
		out, err := cmd.CombinedOutput()
		if len(out) > 0 {
			m.appendLog(job, string(out))
		}
		if err != nil {
			m.appendLog(job, "error: "+err.Error())
			return false
		}
		return true
	}

	if !ensureBuildTools(run) {
		m.finish(job, JobFailed, "")
		return
	}

	if !run("", nil, "git", "clone", "--recurse-submodules",
		"https://github.com/openlibrecommunity/olcrtc", tmpDir) {
		m.finish(job, JobFailed, "")
		return
	}
	if !run(tmpDir, nil, "git", "checkout", ref) {
		m.finish(job, JobFailed, "")
		return
	}
	if !run(tmpDir, nil, "git", "submodule", "update", "--init", "--recursive") {
		m.finish(job, JobFailed, "")
		return
	}

	revParse := exec.Command("git", "rev-parse", "HEAD")
	revParse.Dir = tmpDir
	shaOut, _ := revParse.Output()
	resolvedSHA := strings.TrimSpace(string(shaOut))
	if resolvedSHA == "" {
		resolvedSHA = ref
	}

	if !run(tmpDir, append(goEnv, "GOFLAGS=-buildvcs=false"), "go", "run",
		"github.com/magefile/mage@latest", "build") {
		m.finish(job, JobFailed, resolvedSHA)
		return
	}

	builtPath := filepath.Join(tmpDir, "build", fmt.Sprintf("olcrtc-%s-%s", runtime.GOOS, runtime.GOARCH))
	if _, err := os.Stat(builtPath); err != nil {
		m.appendLog(job, "built binary not found at "+builtPath+": "+err.Error())
		m.finish(job, JobFailed, resolvedSHA)
		return
	}

	data, err := os.ReadFile(builtPath)
	if err != nil {
		m.appendLog(job, "read built binary: "+err.Error())
		m.finish(job, JobFailed, resolvedSHA)
		return
	}
	// Writing straight to destPath fails with "text file busy" whenever the
	// previously-installed olcrtc binary is currently running (the panel
	// execs kernel binaries as long-lived child processes) — a regular
	// open-for-write can't touch a file the kernel has mapped as a running
	// process's text segment. Every other install path in this package
	// (DownloadBinary, DownloadZipEntry, DownloadTarGzEntry) already avoids
	// this by writing to a same-directory temp file and renaming it into
	// place; rename() only swaps the directory entry, so an already-running
	// process keeps its old inode open and is unaffected, matching those
	// functions' own doc comments.
	tmp := destPath + ".download"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		m.appendLog(job, "write "+tmp+": "+err.Error())
		m.finish(job, JobFailed, resolvedSHA)
		return
	}
	if err := os.Rename(tmp, destPath); err != nil {
		os.Remove(tmp)
		m.appendLog(job, "install built binary to "+destPath+": "+err.Error())
		m.finish(job, JobFailed, resolvedSHA)
		return
	}

	m.appendLog(job, fmt.Sprintf("installed to %s (commit %s)", destPath, resolvedSHA))
	m.finish(job, JobSuccess, resolvedSHA)

	if onSuccess != nil {
		if snapshot, ok := m.Get(job.ID); ok {
			onSuccess(resolvedSHA, snapshot.Log)
		}
	}
}
