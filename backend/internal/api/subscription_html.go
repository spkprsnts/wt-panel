package api

import (
	"encoding/base64"
	"html/template"
	"net/http"

	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"

	"wtpanel/internal/models"
)

// renderSubscriptionHTML is the "open the subscription link in a plain browser" page (see
// handleSubscription's format negotiation): traffic, a QR/button for the wireturn:// deep link
// (§4), and a plain-text profile listing.
func (s *Server) renderSubscriptionHTML(c *gin.Context, client models.Client, bundle ProfileBundle, subURL string, expired bool) {
	wireturnLink := buildSubscriptionWireturnLink(subURL)

	type profileView struct {
		Name         string
		CoreType     string
		KernelURI    string
		XrayEnabled  bool
		XrayProtocol string
	}
	views := make([]profileView, 0, len(client.Profiles))
	for _, p := range client.Profiles {
		views = append(views, profileView{
			Name:        p.Name,
			CoreType:    string(p.CoreType),
			KernelURI:   p.KernelURI,
			XrayEnabled: p.XrayEnabled,
		})
	}

	var usedPct int
	if bundle.BytesTotal > 0 {
		usedPct = int(bundle.BytesUsed * 100 / bundle.BytesTotal)
		if usedPct > 100 {
			usedPct = 100
		}
	}

	data := struct {
		Name         string
		Expired      bool
		BytesUsed    string
		BytesTotal   string
		HasLimit     bool
		UsedPct      int
		SubURL       string
		WireturnLink template.URL
		QRDataURI    template.URL
		Profiles     []profileView
	}{
		Name:       client.Name,
		Expired:    expired,
		BytesUsed:  formatBytesShort(bundle.BytesUsed),
		BytesTotal: formatBytesShort(bundle.BytesTotal),
		HasLimit:   bundle.BytesTotal > 0,
		UsedPct:    usedPct,
		SubURL:     subURL,
		// template.URL bypasses html/template's scheme allowlist, which would otherwise rewrite the
		// custom wireturn:// / data: URIs to "#ZgotmplZ". Safe only because both values are
		// backend-generated, never derived from unescaped user input.
		WireturnLink: template.URL(wireturnLink),
		QRDataURI:    template.URL(qrDataURI(wireturnLink)),
		Profiles:     views,
	}

	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Status(http.StatusOK)
	_ = subscriptionPageTmpl.Execute(c.Writer, data)
}

// qrDataURI renders a PNG QR code and returns it as a data: URI — the page
// is a single self-contained response, no separate image request.
func qrDataURI(content string) string {
	png, err := qrcode.Encode(content, qrcode.Medium, 320)
	if err != nil {
		return ""
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(png)
}

var subscriptionPageTmpl = template.Must(template.New("sub").Parse(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{{.Name}} — подписка WireTurn</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; padding: 2rem 1rem 4rem;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #f5f5f7; color: #1c1c1e;
    display: flex; justify-content: center;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #0c0c0e; color: #ededed; }
    .card { background: #1a1a1d !important; border-color: #2c2c30 !important; }
    .muted { color: #9a9aa0 !important; }
    code, .kernel-uri { background: #101012 !important; color: #d8d8dc !important; }
    .bar-track { background: #2c2c30 !important; }
  }
  .wrap { width: 100%; max-width: 480px; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  .muted { color: #6b6b70; font-size: .875rem; }
  .card {
    background: #fff; border: 1px solid #e4e4e7; border-radius: 12px;
    padding: 1.25rem; margin-top: 1rem;
  }
  .bar-track { background: #e4e4e7; border-radius: 999px; height: 8px; overflow: hidden; margin-top: .5rem; }
  .bar-fill { background: #22c55e; height: 100%; }
  .qr { display: flex; justify-content: center; margin: 1rem 0; }
  .qr img { width: 220px; height: 220px; border-radius: 8px; }
  .btn {
    display: block; text-align: center; text-decoration: none;
    padding: .65rem 1rem; border-radius: 8px; font-weight: 600; font-size: .9rem;
    margin-top: .5rem; cursor: pointer; border: none; width: 100%; box-sizing: border-box;
  }
  .btn-primary { background: #2563eb; color: #fff; }
  .btn-secondary { background: #e4e4e7; color: #1c1c1e; }
  @media (prefers-color-scheme: dark) { .btn-secondary { background: #2c2c30; color: #ededed; } }
  .profile {
    border-top: 1px solid #e4e4e7; padding: .75rem 0; font-size: .875rem;
  }
  @media (prefers-color-scheme: dark) { .profile { border-color: #2c2c30; } }
  .profile:first-child { border-top: none; padding-top: 0; }
  .profile-name { font-weight: 600; }
  .badge {
    display: inline-block; font-size: .7rem; padding: .1rem .45rem; border-radius: 999px;
    background: #e4e4e7; margin-left: .4rem;
  }
  @media (prefers-color-scheme: dark) { .badge { background: #2c2c30; } }
  .kernel-uri {
    display: block; margin-top: .35rem; padding: .4rem .5rem; border-radius: 6px;
    background: #f2f2f4; font-size: .72rem; word-break: break-all; font-family: ui-monospace, monospace;
  }
  .expired { color: #dc2626; font-weight: 600; }
</style>
</head>
<body>
<div class="wrap">
  <h1>{{.Name}}</h1>
  {{if .Expired}}<p class="expired">Подписка отключена или истёк срок действия</p>{{end}}

  <div class="card">
    {{if .HasLimit}}
    <div class="muted">Трафик: {{.BytesUsed}} / {{.BytesTotal}}</div>
    <div class="bar-track"><div class="bar-fill" style="width:{{.UsedPct}}%"></div></div>
    {{else}}
    <div class="muted">Трафик: {{.BytesUsed}} (без лимита)</div>
    {{end}}
  </div>

  <div class="card">
    <div class="qr"><img src="{{.QRDataURI}}" alt="QR-код для импорта в WireTurn"></div>
    <a class="btn btn-primary" href="{{.WireturnLink}}">Открыть в WireTurn</a>
    <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('{{.SubURL}}')">Скопировать ссылку подписки</button>
  </div>

  <div class="card">
    {{range .Profiles}}
    <div class="profile">
      <span class="profile-name">{{.Name}}</span>
      <span class="badge">{{.CoreType}}</span>
      {{if .XrayEnabled}}<span class="badge">xray</span>{{end}}
      <code class="kernel-uri">{{.KernelURI}}</code>
    </div>
    {{else}}
    <p class="muted">Профилей пока нет</p>
    {{end}}
  </div>
</div>
</body>
</html>
`))
