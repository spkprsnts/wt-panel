package common

import "net"

// FreePort asks the OS for an unused TCP port by binding to :0 and
// immediately releasing it. Good enough for allocating a port to a
// freshly spawned olcrtc/webdav-tunnel process; there is a small window
// where another process could grab it first, acceptable for a panel
// that provisions profiles one at a time through its own API.
func FreePort() (int, error) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
