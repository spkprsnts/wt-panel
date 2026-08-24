import * as React from "react"
import QRCode from "qrcode"

import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export interface QrVariant {
  key: string
  label: string
  // A plain string when there's only one way to reach this link. An
  // { ip, domain } pair when the panel has both a public IP and a domain
  // configured (see PanelSettings.ListenDomain) — the dialog then shows an
  // "Использовать домен" switch, mirroring 3x-ui's own IP/domain choice
  // for subscription links, instead of silently picking one.
  content: string | { ip: string; domain: string }
}

// QrDialog is the shared "show me a QR code" dialog for both the
// subscription-level (WireTurn / текстовый) and profile-level (WireTurn /
// URI ядра) variants — replaces the old plain "copy the truncated link"
// buttons. Variants are loaded lazily (only once the dialog is actually
// opened) since both call an authenticated backend endpoint.
export function QrDialog({
  trigger,
  title,
  loadVariants,
  onDownload,
  downloadLabel,
}: {
  trigger: React.ReactNode
  title: string
  loadVariants: () => Promise<QrVariant[]>
  onDownload?: () => Promise<void>
  downloadLabel?: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [variants, setVariants] = React.useState<QrVariant[] | null>(null)
  const [activeKey, setActiveKey] = React.useState("")
  const [useDomain, setUseDomain] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [dataUrl, setDataUrl] = React.useState("")
  const [copied, setCopied] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)

  // Keep the latest loadVariants without making it an effect dependency —
  // callers pass a fresh closure every render (it captures client/profile
  // id), and re-running the fetch on every parent re-render (ClientsPage
  // polls every 10s) would refetch links pointlessly while the dialog sits
  // open.
  const loadVariantsRef = React.useRef(loadVariants)
  loadVariantsRef.current = loadVariants

  React.useEffect(() => {
    if (!open) return
    setVariants(null)
    setError(null)
    setDownloadError(null)
    loadVariantsRef.current()
      .then((v) => {
        setVariants(v)
        setActiveKey(v[0]?.key ?? "")
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("qrDialog.loadFailed")))
  }, [open])

  const active = variants?.find((v) => v.key === activeKey) ?? null
  const hasHostChoice = typeof active?.content === "object"
  const activeContent = active
    ? typeof active.content === "string"
      ? active.content
      : (useDomain ? active.content.domain : active.content.ip) || active.content.ip
    : ""

  React.useEffect(() => {
    if (!activeContent) {
      setDataUrl("")
      return
    }
    let cancelled = false
    QRCode.toDataURL(activeContent, { width: 280, margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [activeContent])

  async function handleCopy() {
    if (!activeContent) return
    await navigator.clipboard.writeText(activeContent).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  async function handleDownload() {
    if (!onDownload) return
    setDownloading(true)
    setDownloadError(null)
    try {
      await onDownload()
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : t("qrDialog.downloadFailed"))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !variants && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}

        {variants && variants.length > 0 && (
          <div className="flex flex-col gap-3">
            {variants.length > 1 && (
              <div className="flex gap-2">
                {variants.map((v) => (
                  <Button
                    key={v.key}
                    type="button"
                    size="sm"
                    variant={v.key === activeKey ? "default" : "outline"}
                    onClick={() => setActiveKey(v.key)}
                  >
                    {v.label}
                  </Button>
                ))}
              </div>
            )}

            {hasHostChoice && (
              <div className="flex items-center justify-center gap-2">
                <Label htmlFor="qr-use-domain" className="text-sm font-normal">
                  {t("qrDialog.useDomain")}
                </Label>
                <Switch id="qr-use-domain" checked={useDomain} onCheckedChange={setUseDomain} />
              </div>
            )}

            {dataUrl && (
              <button
                type="button"
                onClick={handleCopy}
                title={t("qrDialog.clickToCopy")}
                className="mx-auto cursor-pointer rounded-md border p-2 transition-opacity hover:opacity-80"
              >
                <img src={dataUrl} alt={active?.label ?? "QR"} className="size-56" />
              </button>
            )}
            <p className="text-center text-xs text-muted-foreground">
              {copied ? t("common.copied") : t("qrDialog.clickQrToCopy")}
            </p>
            <code className="max-h-24 overflow-y-auto rounded-md border bg-muted p-2 text-xs break-all">
              {activeContent}
            </code>
          </div>
        )}

        {onDownload && (
          <DialogFooter className="flex-col items-stretch gap-1 sm:flex-col">
            {downloadError && <p className="text-xs text-destructive">{downloadError}</p>}
            <Button type="button" variant="outline" onClick={handleDownload} disabled={downloading}>
              {downloading ? t("common.downloading") : (downloadLabel ?? t("qrDialog.downloadDefault"))}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
