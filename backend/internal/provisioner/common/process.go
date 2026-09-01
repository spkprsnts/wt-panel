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

// ansiEscapeRe strips ANSI escapes some kernels emit unconditionally.
// Stripped in ReadLog at read time, not write time: wrapping cmd.Stdout in
// an io.Writer forces an internal pipe, and Cmd.Wait() then blocks until
// every fd holder closes it — a grandchild inheriting stdout made Stop() hang.
var ansiEscapeRe = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

// gracefulStopTimeout bounds how long Stop waits for SIGTERM before Kill —
// long enough for a clean shutdown, short enough that one stuck profile can't stall a panel-wide shutdown of many.
const gracefulStopTimeout = 10 * time.Second

// Auto-restart tuning: a crash (not a deliberate Stop) restarts
// automatically. restartBackoffBase doubles per consecutive fast crash up
// to restartBackoffMax, with no permanent give-up; restartHealthyDuration
// resets it once a process stays up a while, so an isolated crash later isn't penalized as part of an old loop.
const (
	restartBackoffBase     = 2 * time.Second
	restartBackoffMax      = 60 * time.Second
	restartHealthyDuration = 30 * time.Second
)

// ProcessSupervisor runs and tracks a single long-lived child process (e.g.
// one olcrtc/webdav-tunnel instance), auto-restarting it with backoff if it
// exits on its own. A background goroutine reaps it via cmd.Wait(), flipping
// `running` false the moment it exits — what makes IsRunning() reflect a
// crash, not just a deliberate Stop.
//
// Deliberately NOT context-aware (plain exec.Command): an early version tied
// it to the request's context, which silently killed every profile's process
// moments after the HTTP response was sent, since Gin cancels that context when the handler returns.
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
	// immediately: manualStop tells the reaper this exit was requested, not
	// a crash; stopCh interrupts an already-scheduled backoff sleep so Stop() wins even mid-backoff.
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

// startLocked does the actual spawn, factored out of Start so supervise's
// auto-restart path (already holding p.mu) can call it directly. Caller must hold p.mu.
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

// supervise reaps the process (only this goroutine calls Wait) and, unless
// the exit was requested via Stop(), schedules an automatic restart with backoff.
func (p *ProcessSupervisor) supervise(cmd *exec.Cmd, done chan struct{}, stopCh chan struct{}) {
	_ = cmd.Wait()

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
		// superseded by a manual Stop/Restart/Start during the wait — don't stomp on it.
		return
	}
	if err := p.startLocked(); err != nil {
		log.Printf("process %q: auto-restart failed: %v", p.name, err)
	}
}

// appendLogNote reopens the log file to note an unexpected exit, so the
// operator sees it in the profile-logs viewer. Best-effort — a failure here shouldn't affect restart logic.
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

// IsRunning reports whether the process is alive — reflects a crash almost
// immediately (the reaper flips this when cmd.Wait() returns), not just a Stop.
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
