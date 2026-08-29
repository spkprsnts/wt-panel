import * as React from "react"
import QRCode from "qrcode"

import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { SectionItem, SwitchRow } from "@/components/ui/section"
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
  content: string
}

// WTMQ1 multi-frame QR — mirrors WireTurn's own doc for this exactly
// (WireTurn repo's docs/qr-transfer.md): frame format, thresholds, and the
// manual "Один QR-код" override. Some entry-point links (mainly turnable://
// with a large pub_key) technically fit in one QR, but the module density
// gets too high for a phone camera to scan reliably. Instead of fountain
// codes, WireTurn just loops a plain animation of several low-density
// frames — the WireTurn scanner (and anything else implementing this same
// doc) reassembles them by concatenating payloads in index order. Short
// content (the overwhelming majority) never chunks — single frame, no
// animation, byte-identical to a plain QR.
const CHUNK_PREFIX = "WTMQ1"
const SINGLE_FRAME_MAX_LENGTH = 700
const CHUNK_PAYLOAD_SIZE = 400
const FRAME_INTERVAL_MS = 450

// Only needs to distinguish this transfer's frames from a previous/unrelated
// one on the reading side — its value doesn't matter otherwise, see the doc.
function randomSessionId() {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0")
}

function buildFrames(text: string, forceStatic: boolean): string[] {
  if (forceStatic || text.length <= SINGLE_FRAME_MAX_LENGTH) return [text]

  const chunks: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_PAYLOAD_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_PAYLOAD_SIZE))
  }

  const sessionId = randomSessionId()
  const total = chunks.length
  return chunks.map((chunk, i) => `${CHUNK_PREFIX}|${sessionId}|${i + 1}|${total}|${chunk}`)
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
  trigger: React.ReactElement
  title: string
  loadVariants: () => Promise<QrVariant[]>
  onDownload?: () => Promise<void>
  downloadLabel?: string
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [variants, setVariants] = React.useState<QrVariant[] | null>(null)
  const [activeKey, setActiveKey] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [dataUrl, setDataUrl] = React.useState("")
  const [copied, setCopied] = React.useState(false)
  const [downloading, setDownloading] = React.useState(false)
  const [downloadError, setDownloadError] = React.useState<string | null>(null)
  const [forceStatic, setForceStatic] = React.useState(false)
  const [frameIndex, setFrameIndex] = React.useState(0)

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
    setForceStatic(false)
    loadVariantsRef.current()
      .then((v) => {
        setVariants(v)
        setActiveKey(v[0]?.key ?? "")
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("qrDialog.loadFailed")))
  }, [open])

  const active = variants?.find((v) => v.key === activeKey) ?? null
  const activeContent = active?.content ?? ""
  const canChunk = activeContent.length > SINGLE_FRAME_MAX_LENGTH

  const frames = React.useMemo(
    () => buildFrames(activeContent, forceStatic),
    [activeContent, forceStatic]
  )

  // Resets to the first frame whenever the set itself changes (new variant,
  // or flipping forceStatic) — an index left over from a previous, longer
  // set would be out of bounds the moment the set shrinks — then starts the
  // loop that advances it, if there's more than one frame to loop through.
  React.useEffect(() => {
    setFrameIndex(0)
    if (frames.length <= 1) return undefined
    const id = window.setInterval(() => {
      setFrameIndex((i) => (i + 1) % frames.length)
    }, FRAME_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [frames])

  const currentFrame = frames[frameIndex] ?? ""

  React.useEffect(() => {
    if (!currentFrame) {
      setDataUrl("")
      return
    }
    let cancelled = false
    QRCode.toDataURL(currentFrame, { width: 280, margin: 1 }).then((url) => {
      if (!cancelled) setDataUrl(url)
    })
    return () => {
      cancelled = true
    }
  }, [currentFrame])

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
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        {error && <p className="text-sm text-error">{error}</p>}
        {!error && !variants && <p className="text-sm text-on-surface-variant">{t("common.loading")}</p>}

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
            {frames.length > 1 && (
              <p className="text-center text-xs text-on-surface-variant">
                {t("qrDialog.frameLabel")} {frameIndex + 1} / {frames.length}
              </p>
            )}
            <p className="text-center text-xs text-on-surface-variant">
              {copied ? t("common.copied") : t("qrDialog.clickQrToCopy")}
            </p>
            <code className="max-h-24 overflow-y-auto rounded-md border bg-surface-variant p-2 text-xs break-all">
              {activeContent}
            </code>
            {canChunk && (
              <SectionItem
                position="single"
                role="switch"
                aria-checked={forceStatic}
                onClick={() => setForceStatic(!forceStatic)}
              >
                <SwitchRow
                  label={t("qrDialog.forceStaticLabel")}
                  checked={forceStatic}
                  onCheckedChange={setForceStatic}
                  supportingText={t("qrDialog.forceStaticHint")}
                />
              </SectionItem>
            )}
          </div>
        )}

        {onDownload && (
          <DialogFooter className="flex-col items-stretch gap-1 sm:flex-col">
            {downloadError && <p className="text-xs text-error">{downloadError}</p>}
            <Button type="button" variant="outline" onClick={handleDownload} disabled={downloading}>
              {downloading ? t("common.downloading") : (downloadLabel ?? t("qrDialog.downloadDefault"))}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
