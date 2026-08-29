package turnable

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Keygen shells out to the Turnable binary's own 'config keygen' command
// (docs/server/SETUP.md upstream) to mint a fresh ML-KEM-768 keypair for
// one profile — no reason to hand-roll this when the binary already
// provides it. Exported so the API layer can expose it as a "generate"
// button without going through AddProfile.
func Keygen(ctx context.Context, binPath string) (pubKey, privKey string, err error) {
	cmd := exec.CommandContext(ctx, binPath, "config", "keygen")
	out, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("turnable config keygen: %w", err)
	}

	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		switch {
		case strings.HasPrefix(line, "pub_key="):
			pubKey = strings.TrimPrefix(line, "pub_key=")
		case strings.HasPrefix(line, "priv_key="):
			privKey = strings.TrimPrefix(line, "priv_key=")
		}
	}
	if pubKey == "" || privKey == "" {
		return "", "", fmt.Errorf("turnable config keygen: could not parse pub_key/priv_key from output: %q", out)
	}
	return pubKey, privKey, nil
}
