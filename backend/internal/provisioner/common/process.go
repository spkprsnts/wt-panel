package common

import (
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sync"
	"syscall"
	"time"
)

// ansiEscapeRe matches ANSI/VT100 escape sequences (SGR color codes,
// cursor movement, etc.) — Turnable and some of the other kernels
// colorize their own log output unconditionally, even when not attached
// to a real terminal, which otherwise leaves raw "\x1b[32m" bytes in the
// profile-logs viewer on the Xray/profile pages. Stripped in ReadLog, at
// read time, not at write time: an earlier version of this wrapped
// cmd.Stdout/Stderr in a Go-side io.Writer to strip inline, but that forces
// exec.Cmd to create an internal pipe instead of handing the child the raw
// fd — and Cmd.Wait() then blocks until every process holding a copy of
// that fd closes it, not just the direct child. A kernel binary that forks
// a grandchild inheriting stdout/stderr (confirmed with a plain `sh -c
// "sleep 300"` test child) made Stop() hang waiting on a pipe nothing was
// ever going to close. Reading the raw file and stripping on the way out
// avoids that class of bug entirely.
var ansiEscapeRe = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

// gracefulStopTimeout bounds how long Stop waits for SIGTERM to actually
// end the process before falling back to Kill. Long enough for a kernel
// binary to flush/close things on its own SIGTERM handler (if it has one),
// short enough that one unresponsive profile can't stall a panel-wide
// graceful shutdown that's stopping many of these one after another.
const gracefulStopTimeout = 10 * time.Second

// Auto-restart tuning: a kernel process that exits on its own (a crash, not
// a deliberate Stop) is restarted automatically instead of just sitting
// dead until an operator happens to notice and re-saves the profile (today
// the only thing that calls Restart()). restartBackoffBase doubles on each
// consecutive fast crash — a genuinely broken binary/config shouldn't be
// retried once every 2 seconds forever — capped at restartBackoffMax, and
// there's deliberately no permanent give-up: worst case is one restart
// attempt a minute, which is cheap enough to just leave running.
// restartHealthyDuration resets that growth back to the base delay once a
// process proves it can stay up for a while, so an isolated crash months
// apart isn't penalized as if it were a continuation of an old loop.
const (
	restartBackoffBase     = 2 * time.Second
	restartBackoffMax      = 60 * time.Second
	restartHealthyDuration = 30 * time.Second
)

// ProcessSupervisor runs and tracks a single long-lived child process
// (e.g. one olcrtc or webdav-tunnel instance), restarting it automatically
// (with backoff, see above) if it exits on its own.
//
// A background goroutine spawned in Start reaps the process via cmd.Wait()
// and flips `running` to false the moment it actually exits — this is what
// makes IsRunning() reflect a crash (not just a deliberate Stop) instead of
// going stale, since exec.Cmd's own ProcessState is only populated once
// something calls Wait(). That same goroutine is what drives auto-restart.
//
// Deliberately NOT context-aware: Start uses plain exec.Command, not
// exec.CommandContext. These processes are meant to outlive whatever
// request triggered them (AddProfile/UpdateProfile/Restore all run inside
// an HTTP handler, and Gin cancels the request's context the moment the
// handler returns) — their lifecycle is controlled exclusively by calling
// Stop(), never by a caller's context expiring. A context.Context parameter
// here would be a foot-gun: an early version of this code passed the HTTP
// request's context straight into exec.CommandContext, which silently
// killed every profile's process a few hundred milliseconds after it
// started, right after the API response was sent.
type ProcessSupervisor struct {
	mu      sync.Mutex
	name    string
	binPath string
	args    []string
	logPath string
	cmd     *exec.Cmd
	running bool
	done    chan struct{} // closed by the reaper goroutine once cmd.Wait() returns

	// manualStop and stopCh together let Stop() cancel auto-restart
	// immediately and unconditionally. manualStop tells the reaper
	// goroutine (once cmd.Wait() returns) that this particular exit was
	// requested, not a crash, so it shouldn't schedule a restart. stopCh
	// additionally interrupts an already-scheduled backoff sleep — needed
	// because Stop() must win even when called on a process that had
	// already crashed and is currently mid-backoff (RemoveProfile calling
	// Stop() on a crashed profile must not let it come back afterward;
	// Stop() alone can't rely on signaling a process that isn't running).
	manualStop bool
	stopCh     chan struct{}

	crashCount int
	startedAt  time.Time
}

func NewProcessSupervisor(name, binPath string, args []string, logDir string) *ProcessSupervisor {
	return &ProcessSupervisor{
		name:    name,
		binPath: binPath,
		args:    args,
		logPath: filepath.Join(logDir, name+".log"),
	}
}

func (p *ProcessSupervisor) Start() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.startLocked()
}

// startLocked does the actual spawn — factored out of Start so the
// auto-restart path in supervise (which already holds p.mu when it
// decides to retry) can call it directly. Caller must hold p.mu.
func (p *ProcessSupervisor) startLocked() error {
	if p.running {
		return fmt.Errorf("process %q already running (pid %d)", p.name, p.cmd.Process.Pid)
	}

	logFile, err := os.OpenFile(p.logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("open log file: %w", err)
	}

	cmd := exec.Command(p.binPath, p.args...)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	prepareChildLifetime(cmd) // arms Pdeathsig before the fork+exec — see process_lifetime.go
	if err := cmd.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("start %q: %w", p.name, err)
	}
	logFile.Close() // the child process holds its own fd to the file now

	p.cmd = cmd
	p.running = true
	p.manualStop = false
	p.startedAt = time.Now()
	stopCh := make(chan struct{})
	p.stopCh = stopCh
	done := make(chan struct{})
	p.done = done

	go p.supervise(cmd, done, stopCh)
	return nil
}

// supervise reaps the process (only this goroutine ever calls Wait) and,
// unless the exit was requested via Stop(), schedules an automatic restart
// with backoff (see the constants above).
func (p *ProcessSupervisor) supervise(cmd *exec.Cmd, done chan struct{}, stopCh chan struct{}) {
	_ = cmd.Wait() // reaps the process; only this goroutine ever calls Wait

	p.mu.Lock()
	manualStop := p.manualStop
	if p.cmd == cmd {
		p.running = false
	}
	ranFor := time.Since(p.startedAt)
	p.mu.Unlock()
	close(done)

	if !manualStop {
		p.appendLogNote(fmt.Sprintf("[wt-panel] process exited unexpectedly after %s", ranFor.Round(time.Second)))
	} else {
		return
	}

	p.mu.Lock()
	if ranFor >= restartHealthyDuration {
		p.crashCount = 0
	}
	backoff := restartBackoffBase << p.crashCount
	if backoff > restartBackoffMax || backoff <= 0 {
		backoff = restartBackoffMax
	}
	p.crashCount++
	p.mu.Unlock()

	log.Printf("process %q exited unexpectedly — auto-restarting in %s", p.name, backoff)
	select {
	case <-time.After(backoff):
	case <-stopCh:
		return // Stop() was called while we were waiting — respect it
	}

	p.mu.Lock()
	defer p.mu.Unlock()
	if p.cmd != cmd {
		// superseded by a manual Stop/Restart/Start during the wait —
		// don't stomp on whatever that did.
		return
	}
	if err := p.startLocked(); err != nil {
		log.Printf("process %q: auto-restart failed: %v", p.name, err)
	}
}

// appendLogNote briefly reopens the log file to append one line — used to
// mark an unexpected exit in the same log the operator already views via
// the profile-logs viewer. Best-effort: a failure to annotate (disk full,
// permissions) shouldn't affect the actual restart logic.
func (p *ProcessSupervisor) appendLogNote(line string) {
	f, err := os.OpenFile(p.logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	fmt.Fprintln(f, line)
}

func (p *ProcessSupervisor) Stop() error {
	p.mu.Lock()
	p.manualStop = true
	if p.stopCh != nil {
		select {
		case <-p.stopCh: // already closed
		default:
			close(p.stopCh)
		}
	}
	cmd := p.cmd
	done := p.done
	running := p.running
	p.mu.Unlock()

	if cmd == nil || cmd.Process == nil || !running {
		return nil
	}

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		// best-effort: process may already be gone — fall back to Kill.
		_ = cmd.Process.Kill()
	}
	if done != nil {
		select {
		case <-done:
			// exited on its own — a real SIGTERM-triggered graceful stop,
			// giving the kernel binary a chance to run its own cleanup.
		case <-time.After(gracefulStopTimeout):
			// didn't quit in time; stop waiting politely.
			_ = cmd.Process.Kill()
			<-done
		}
	}

	p.mu.Lock()
	if p.cmd == cmd {
		p.cmd = nil
	}
	p.mu.Unlock()
	return nil
}

func (p *ProcessSupervisor) Restart() error {
	if err := p.Stop(); err != nil {
		return err
	}
	return p.Start()
}

// SetArgs changes the arguments used on the next Start/Restart. It does not
// affect an already-running process — call Restart afterwards to apply it.
func (p *ProcessSupervisor) SetArgs(args []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.args = args
}

func (p *ProcessSupervisor) PID() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.running || p.cmd == nil || p.cmd.Process == nil {
		return 0
	}
	return p.cmd.Process.Pid
}

// IsRunning reports whether the process is currently alive. Reflects a
// crash almost immediately (the reaper goroutine started in Start flips
// this the moment cmd.Wait() returns), not just a deliberate Stop.
func (p *ProcessSupervisor) IsRunning() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.running
}

// ReadLog returns the tail of this process's combined stdout/stderr log —
// up to maxBytes bytes (0 = whole file). Safe to call whether or not the
// process is currently running.
func (p *ProcessSupervisor) ReadLog(maxBytes int) (string, error) {
	data, err := os.ReadFile(p.logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	if maxBytes > 0 && len(data) > maxBytes {
		data = data[len(data)-maxBytes:]
	}
	return ansiEscapeRe.ReplaceAllString(string(data), ""), nil
}
