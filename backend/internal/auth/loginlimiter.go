package auth

import (
	"sync"
	"time"
)

// maxFailedLoginAttempts/loginLockoutDuration mirror 3x-ui's own login brute-force guard: high
// enough a fat-fingered password never trips it, low enough to stop a real brute force.
const (
	maxFailedLoginAttempts = 5
	loginLockoutDuration   = 15 * time.Minute
	// loginAttemptTTL bounds how long an inactive IP's entry stays in the map, so probing from many
	// IPs doesn't grow it forever. Swept lazily (see sweepLocked), not on a timer.
	loginAttemptTTL = time.Hour
)

type loginAttemptState struct {
	failures    int
	lockedUntil time.Time
	lastSeen    time.Time
}

// LoginLimiter tracks failed /api/login attempts per client address and locks an address out after
// too many — a plain in-memory guard, mirroring 3x-ui's own login lockout. State is deliberately not
// persisted: a restart resetting every count is an acceptable tradeoff for staying a self-contained
// struct, and an attacker who can restart the panel has bigger problems than a login rate limit.
type LoginLimiter struct {
	mu       sync.Mutex
	attempts map[string]*loginAttemptState
}

func NewLoginLimiter() *LoginLimiter {
	return &LoginLimiter{attempts: make(map[string]*loginAttemptState)}
}

// Locked reports whether addr is currently locked out.
func (l *LoginLimiter) Locked(addr string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sweepLocked()
	a, ok := l.attempts[addr]
	if !ok {
		return false
	}
	return time.Now().Before(a.lockedUntil)
}

// RecordFailure counts one more wrong password/code from addr, locking it
// out once maxFailedLoginAttempts is reached.
func (l *LoginLimiter) RecordFailure(addr string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a, ok := l.attempts[addr]
	if !ok {
		a = &loginAttemptState{}
		l.attempts[addr] = a
	}
	a.failures++
	a.lastSeen = time.Now()
	if a.failures >= maxFailedLoginAttempts {
		a.lockedUntil = time.Now().Add(loginLockoutDuration)
	}
}

// RecordSuccess clears addr's failure count so a couple of earlier typos don't leave it one mistake
// away from a lockout.
func (l *LoginLimiter) RecordSuccess(addr string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.attempts, addr)
}

// sweepLocked drops entries that are both not currently locked and haven't
// been touched in loginAttemptTTL. Caller must hold l.mu.
func (l *LoginLimiter) sweepLocked() {
	now := time.Now()
	for addr, a := range l.attempts {
		if now.After(a.lockedUntil) && now.Sub(a.lastSeen) > loginAttemptTTL {
			delete(l.attempts, addr)
		}
	}
}
