package common

import (
	"os/exec"
	"syscall"
)

// prepareChildLifetime asks the kernel to deliver SIGKILL to the child the
// moment this process's thread-group leader dies, for ANY reason — clean
// exit, crash, or `kill -9`. This is the only mechanism that also covers
// the crash case: our own Stop()/cleanup code never runs if the panel
// itself is killed outright, so the kernel has to enforce it independently.
func prepareChildLifetime(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Pdeathsig = syscall.SIGKILL
}
