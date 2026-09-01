package common

import "net"

// FreePort asks the OS for an unused TCP port by binding to :0 and
// releasing it. Good enough for a panel that provisions profiles one at a
// time — small race window against another process grabbing it first.
func FreePort() (int, error) {
	l, err := net.Listen("tcp", ":0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
