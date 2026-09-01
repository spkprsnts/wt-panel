package common

import (
	"os/exec"
	"syscall"
)

// prepareChildLifetime has the kernel SIGKILL the child the moment this
// process dies for any reason — the only mechanism that also covers a
// crash, since our own Stop()/cleanup never runs if the panel is killed outright.
func prepareChildLifetime(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Pdeathsig = syscall.SIGKILL
}
