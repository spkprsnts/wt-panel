package olcrtc

import "testing"

func TestParseSocksProxy(t *testing.T) {
	cases := []struct {
		name    string
		input   string
		want    *socksYAML
		wantErr bool
	}{
		{name: "empty", input: "", want: nil},
		{
			name:  "host and port only",
			input: "socks5://127.0.0.1:1080",
			want:  &socksYAML{ProxyAddr: "127.0.0.1", ProxyPort: 1080},
		},
		{
			name:  "with user and pass",
			input: "socks5://alice:s3cret@10.0.0.1:1080",
			want:  &socksYAML{ProxyAddr: "10.0.0.1", ProxyPort: 1080, ProxyUser: "alice", ProxyPass: "s3cret"},
		},
		{
			name:  "user only, no password",
			input: "socks5://alice@10.0.0.1:1080",
			want:  &socksYAML{ProxyAddr: "10.0.0.1", ProxyPort: 1080, ProxyUser: "alice"},
		},
		{name: "wrong scheme", input: "http://127.0.0.1:1080", wantErr: true},
		{name: "missing port", input: "socks5://127.0.0.1", wantErr: true},
		{name: "non-numeric port", input: "socks5://127.0.0.1:notaport", wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseSocksProxy(tc.input)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got none (result: %+v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.want == nil {
				if got != nil {
					t.Fatalf("expected nil, got %+v", got)
				}
				return
			}
			if got == nil {
				t.Fatalf("expected %+v, got nil", tc.want)
			}
			if *got != *tc.want {
				t.Fatalf("got %+v, want %+v", *got, *tc.want)
			}
		})
	}
}
