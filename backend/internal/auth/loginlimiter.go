package auth

import (
	"sync"
	"time"
)

// maxFailedLoginAttempts/loginLockoutDuration mirror 3x-ui's own login
// brute-force guard: high enough that an operator fat-fingering their own
// password twice never trips it, low enough that it actually stops a
// real brute force before it gets anywhere against a real password (let
// alone a 6-digit TOTP code, see totp.go).
const (
	maxFailedLoginAttempts = 5
	loginLockoutDuration   = 15 * time.Minute
	// loginAttemptTTL bounds how long a non-locked, inactive IP's entry
	// stays in the map — without this, a panel getting probed from many
	// different IPs over its lifetime would grow this forever. Swept
	// lazily (see sweepLocked) rather than on a timer, so there's nothing
	// extra to start/stop alongside the panel's own lifecycle.
	loginAttemptTTL = time.Hour
)

type loginAttemptState struct {
	failures    int
	lockedUntil time.Time
	lastSeen    time.Time
}

// LoginLimiter tracks failed /api/login attempts per client address and
// temporarily locks an address out after too many — a plain in-memory
// brute-force guard, mirroring 3x-ui's own login lockout. State is
// deliberately NOT persisted: a panel restart resetting every address's
// count is an acceptable tradeoff for staying a single self-contained
// struct instead of a DB table and migration, and an attacker who can
// restart the panel process already has much bigger problems than a login
// rate limit.
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

// RecordSuccess clears addr's failure count on a real successful login —
// getting the password right after a couple of typos shouldn't leave that
// address permanently one mistake away from a lockout.
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
