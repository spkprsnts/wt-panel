package turnable

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
)

// Keygen shells out to Turnable's own 'config keygen' to mint a fresh
// ML-KEM-768 keypair. Exported so the API layer can expose a "generate" button without going through AddProfile.
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
