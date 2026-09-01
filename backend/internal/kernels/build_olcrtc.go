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

// olcRTC has no releases upstream, so pinning a state means building from
// source at a chosen commit — a multi-minute pipeline, run as a background
// Job the API layer polls instead of blocking the request.
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
	// latest maps kernel name to its most recent job id, so LatestJob lets
	// the Kernels page resume showing progress after a reload.
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

// LatestJob returns the most recently started job for kernel, if any has
// run since the panel started; false if this kernel has never had a job.
func (m *JobManager) LatestJob(kernel string) (Job, bool) {
	m.mu.Lock()
	id, ok := m.latest[kernel]
	m.mu.Unlock()
	if !ok {
		return Job{}, false
	}
	return m.Get(id)
}

// startJob registers a job as the kernel's "latest" and refuses a second
// concurrent one for the same kernel — otherwise reloading mid-install and
// re-clicking install would kick off a redundant download/build.
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
// returns immediately; poll Get(id) for progress. onSuccess runs from that
// goroutine the moment the build finishes, not from whatever request later
// polls — so a job that outlives every watching client still records its
// result (see handlers_kernels.go's recordKernelInstall).
func (m *JobManager) StartOlcRTCBuild(ref, destPath, dataDir string, onSuccess func(version, log string)) *Job {
	job, running := m.startJob("olcrtc", ref)
	if running {
		return job
	}
	go m.runOlcRTCBuild(job, ref, destPath, dataDir, onSuccess)
	return job
}

// StartInstall runs a release-download install as a background job with the
// same reload-safety guarantee as StartOlcRTCBuild: onSuccess fires from
// this goroutine, not from whatever request later polls for the result.
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

// ensureBuildTools makes sure git and a Go toolchain are on PATH — a fresh
// server has neither (Turnable/FreeTurn ship prebuilt; install.sh doesn't
// set these up for building olcrtc). git comes from apt; Go doesn't — apt's
// golang-go lags years behind upstream, so a missing/too-old go instead gets the real tarball from go.dev.
func ensureBuildTools(run func(dir string, env []string, name string, args ...string) bool) bool {
	if _, err := exec.LookPath("git"); err != nil {
		if !run("", nil, "sh", "-c", "apt-get update -qq && apt-get install -y -qq git curl") {
			return false
		}
	}

	if _, err := exec.LookPath("go"); err != nil {
		// May already be installed this way, but this process's PATH
		// (captured at startup) doesn't include it.
		if _, statErr := os.Stat("/usr/local/go/bin/go"); statErr == nil {
			os.Setenv("PATH", "/usr/local/go/bin:"+os.Getenv("PATH"))
		} else {
			arch := runtime.GOARCH
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

// olcrtcSwapFile is a dedicated path so this never touches a swap file the
// operator set up for other reasons.
const olcrtcSwapFile = "/var/lib/wt-panel-olcrtc-build.swap"

// olcrtcBuildMemThresholdKB is olcRTC's documented cutoff below which the
// build may crash from OOM; below it we add swap via the same
// fallocate+mkswap+swapon recipe upstream docs give as the fix.
const olcrtcBuildMemThresholdKB = 4 * 1024 * 1024

// ensureSwapForBuild is a no-op once RAM+swap already clears the threshold.
// /proc/meminfo read failures fail open — better to attempt the build than block over a diagnostic that couldn't run.
func ensureSwapForBuild(run func(dir string, env []string, name string, args ...string) bool) bool {
	totalKB, swapKB, err := readMemInfoKB()
	if err != nil {
		return true
	}
	if totalKB+swapKB >= olcrtcBuildMemThresholdKB {
		return true
	}

	if _, err := os.Stat(olcrtcSwapFile); err == nil {
		// Created by an earlier build — re-activate it (a reboot drops it;
		// swapon on an already-active file is a harmless no-op).
		run("", nil, "swapon", olcrtcSwapFile)
		return true
	}

	if !run("", nil, "fallocate", "-l", "4G", olcrtcSwapFile) {
		// fallocate can fail on some overlay/network mounts — dd works everywhere, just slower.
		if !run("", nil, "dd", "if=/dev/zero", "of="+olcrtcSwapFile, "bs=1M", "count=4096") {
			return false
		}
	}
	return run("", nil, "chmod", "600", olcrtcSwapFile) &&
		run("", nil, "mkswap", olcrtcSwapFile) &&
		run("", nil, "swapon", olcrtcSwapFile)
}

// readMemInfoKB reads MemTotal/SwapTotal (kB) from /proc/meminfo — simpler
// than summing /proc/swaps by hand.
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

// olcrtcGoEnv points GOPATH/GOCACHE/GOMODCACHE/HOME at a fixed dir under the
// data dir: the panel runs as a systemd service with no HOME, so "go run"
// would otherwise fail with "module cache not found". Also lets the module
// cache survive across builds, unlike tmpDir which is wiped each run.
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
	// Writing straight to destPath fails with "text file busy" if the old
	// binary is currently running. Temp file + rename instead (like
	// DownloadBinary et al.) — rename only swaps the directory entry, leaving a running process's inode alone.
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
