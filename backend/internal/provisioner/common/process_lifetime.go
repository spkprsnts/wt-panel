package common

import (
	"os/exec"
	"syscall"
)

// prepareChildLifetime asks the kernel to deliver SIGKILL to the child the
// moment this process's thread-group leader dies, for ANY reason — a clean
// exit, a crash, or an operator's `kill -9`. This is the only mechanism
// that also covers the crash case: our own Stop()/deferred cleanup code
// never gets to run if the panel itself is killed outright, so relying on
// "we'll tell the child to quit" isn't enough — the kernel has to enforce
// it independently of whether our code runs at all. Linux/Unix only — this
// panel no longer supports Windows (see README).
func prepareChildLifetime(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Pdeathsig = syscall.SIGKILL
}
