import * as React from "react"

import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"

// open/onOpenChange are controlled by the caller (ClientsPage's dropdown menu) since a Dialog can't safely nest inside a DropdownMenuItem.
export function ProfileLogsDialog({
  profileId,
  profileName,
  open,
  onOpenChange,
}: {
  profileId: number
  profileName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const [log, setLog] = React.useState("")
  const [running, setRunning] = React.useState(false)
  const [pid, setPid] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const logRef = React.useRef<HTMLPreElement | null>(null)
  const pollRef = React.useRef<number | null>(null)

  async function fetchLogs() {
    setError(null)
    try {
      const resp = await api.getProfileLogs(profileId)
      setLog(resp.log)
      setRunning(resp.running)
      setPid(resp.pid)
    } catch (err) {
      setError(err instanceof Error ? err.message : t("profileLogs.loadFailed"))
    } finally {
      setLoading(false)
    }
  }

  // The parent flips `open` directly (a dropdown item, not a DialogTrigger); Base UI's onOpenChange only covers the dialog's own internal closes, so polling has to watch `open` itself.
  React.useEffect(() => {
    if (!open) return
    setLoading(true)
    fetchLogs()
    pollRef.current = window.setInterval(fetchLogs, 3000)
    return () => {
      if (pollRef.current) {
        window.clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [open, profileId])

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("profileLogs.title")}: {profileName}
          </DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2 text-sm">
          <Badge variant={running ? "default" : "secondary"}>
            {running ? t("profileLogs.running") : t("profileLogs.notRunning")}
          </Badge>
          {running && pid > 0 && <span className="text-on-surface-variant">PID {pid}</span>}
          <Button size="sm" variant="outline" className="ml-auto" onClick={fetchLogs} disabled={loading}>
            {t("profileLogs.refresh")}
          </Button>
        </div>
        {error && <p className="text-sm text-error">{error}</p>}
        <pre
          ref={logRef}
          className="max-h-[55vh] overflow-auto rounded-md border bg-surface-variant/30 p-3 text-xs whitespace-pre-wrap"
        >
          {log || (loading ? t("common.loading") : t("profileLogs.empty"))}
        </pre>
      </DialogContent>
    </Dialog>
  )
}
