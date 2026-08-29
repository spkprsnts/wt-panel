import * as React from "react"

import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface ConfirmOptions {
  title?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface AlertOptions {
  title?: string
  okLabel?: string
}

interface DialogPromptContextValue {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>
  alert: (message: string, options?: AlertOptions) => Promise<void>
}

const DialogPromptContext = React.createContext<DialogPromptContextValue | null>(null)

type Pending =
  | { kind: "confirm"; message: string; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "alert"; message: string; options: AlertOptions; resolve: () => void }

// App-wide replacement for window.confirm/alert, which block the whole tab
// and can't be styled. Mounted once in App.tsx. useDialogPrompt()'s
// confirm/alert are drop-in async replacements: `if (!confirm(msg)) return`
// becomes `if (!(await confirm(msg))) return`.
export function DialogPromptProvider({ children }: { children: React.ReactNode }) {
  const t = useT()
  const [pending, setPending] = React.useState<Pending | null>(null)

  const confirm = React.useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      setPending({ kind: "confirm", message, options, resolve })
    })
  }, [])

  const alertFn = React.useCallback((message: string, options: AlertOptions = {}) => {
    return new Promise<void>((resolve) => {
      setPending({ kind: "alert", message, options, resolve })
    })
  }, [])

  function resolveConfirm(value: boolean) {
    if (pending?.kind === "confirm") pending.resolve(value)
    setPending(null)
  }

  function resolveAlert() {
    if (pending?.kind === "alert") pending.resolve()
    setPending(null)
  }

  const contextValue = React.useMemo(() => ({ confirm, alert: alertFn }), [confirm, alertFn])

  return (
    <DialogPromptContext.Provider value={contextValue}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (open) return
          // Closing via Escape/outside click/the X button with no explicit
          // choice made — treat exactly like Cancel (confirm) or OK (alert)
          // rather than leaving the caller's promise unresolved forever.
          if (pending?.kind === "confirm") resolveConfirm(false)
          else if (pending?.kind === "alert") resolveAlert()
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {pending?.options.title ?? (pending?.kind === "confirm" ? t("common.confirmTitle") : t("common.notice"))}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line">{pending?.message}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {pending?.kind === "confirm" ? (
              <>
                <Button variant="outline" onClick={() => resolveConfirm(false)}>
                  {pending.options.cancelLabel ?? t("common.cancel")}
                </Button>
                <Button
                  variant={pending.options.destructive ? "destructive" : "default"}
                  onClick={() => resolveConfirm(true)}
                >
                  {pending.options.confirmLabel ?? t("common.confirm")}
                </Button>
              </>
            ) : (
              <Button onClick={resolveAlert}>{pending?.options.okLabel ?? t("common.ok")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DialogPromptContext.Provider>
  )
}

export function useDialogPrompt() {
  const ctx = React.useContext(DialogPromptContext)
  if (!ctx) {
    throw new Error("useDialogPrompt must be used within DialogPromptProvider")
  }
  return ctx
}
