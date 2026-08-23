// Package sysstat reports basic host resource usage (CPU/RAM/disk) for the
// Dashboard page. Linux-only (see README) — reads /proc directly and uses
// Statfs rather than pulling in a metrics library for three numbers.
package sysstat

import (
	"os"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type Stats struct {
	CPUPercent     float64 `json:"cpuPercent"`
	CPUCores       int     `json:"cpuCores"`
	MemUsedBytes   uint64  `json:"memUsedBytes"`
	MemTotalBytes  uint64  `json:"memTotalBytes"`
	DiskUsedBytes  uint64  `json:"diskUsedBytes"`
	DiskTotalBytes uint64  `json:"diskTotalBytes"`
}

// Collect samples CPU usage over a short window — the standard /proc/stat
// delta technique, since Linux doesn't expose instantaneous CPU usage any
// other way — then reads memory and disk space for diskPath (the panel's
// own data directory: "is the panel about to run out of room for its DB/
// kernel binaries/logs", the operationally relevant question, not
// necessarily the same filesystem the OS itself lives on).
//
// The 200ms sleep runs synchronously inside the HTTP handler that calls
// this — deliberately: this is an occasionally-polled admin dashboard
// stat, not a hot path, and that's simpler than a background sampler
// goroutine for three numbers.
func Collect(diskPath string) (Stats, error) {
	var s Stats

	idle1, total1, err := readCPUSample()
	if err != nil {
		return s, err
	}
	time.Sleep(200 * time.Millisecond)
	idle2, total2, err := readCPUSample()
	if err != nil {
		return s, err
	}
	idleDelta := float64(idle2 - idle1)
	totalDelta := float64(total2 - total1)
	if totalDelta > 0 {
		s.CPUPercent = (1 - idleDelta/totalDelta) * 100
	}
	s.CPUCores = numCPU()

	memUsed, memTotal, err := readMemUsage()
	if err != nil {
		return s, err
	}
	s.MemUsedBytes = memUsed
	s.MemTotalBytes = memTotal

	diskUsed, diskTotal, err := readDiskUsage(diskPath)
	if err != nil {
		return s, err
	}
	s.DiskUsedBytes = diskUsed
	s.DiskTotalBytes = diskTotal

	return s, nil
}

// numCPU counts "cpuN" lines in /proc/stat (cpu0, cpu1, ...) rather than
// using runtime.NumCPU(), which reflects this process's own affinity/
// cgroup limit, not necessarily the whole host's core count an operator
// looking at a dashboard would expect.
func numCPU() int {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 1
	}
	n := 0
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "cpu") && len(line) > 3 && line[3] >= '0' && line[3] <= '9' {
			n++
		}
	}
	if n == 0 {
		return 1
	}
	return n
}

// readCPUSample returns the aggregate "cpu" line's idle and total tick
// counts (USER_HZ units — the absolute value is meaningless, only the
// delta between two samples is).
func readCPUSample() (idle, total uint64, err error) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, err
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "cpu ") {
			continue
		}
		fields := strings.Fields(line)[1:] // drop the "cpu" label
		for i, f := range fields {
			v, _ := strconv.ParseUint(f, 10, 64)
			total += v
			if i == 3 { // idle is the 4th field (user, nice, system, idle, ...)
				idle = v
			}
		}
		return idle, total, nil
	}
	return 0, 0, nil
}

func readMemUsage() (used, total uint64, err error) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, err
	}
	var totalKB, availKB uint64
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB, _ = strconv.ParseUint(fields[1], 10, 64)
		case "MemAvailable:":
			availKB, _ = strconv.ParseUint(fields[1], 10, 64)
		}
	}
	total = totalKB * 1024
	if availKB > 0 && availKB*1024 <= total {
		used = total - availKB*1024
	}
	return used, total, nil
}

// readDiskUsage uses Bavail (space available to a non-root user), not the
// raw free-block count — a more realistic "how much can actually still be
// written" figure on filesystems with reserved root-only blocks.
func readDiskUsage(path string) (used, total uint64, err error) {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return 0, 0, err
	}
	total = uint64(stat.Blocks) * uint64(stat.Bsize)
	free := uint64(stat.Bavail) * uint64(stat.Bsize)
	if free <= total {
		used = total - free
	}
	return used, total, nil
}
