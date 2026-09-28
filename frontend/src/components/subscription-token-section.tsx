import * as React from "react"

import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { SectionGroup, SectionItem, TextFieldRow } from "@/components/ui/section"

export interface SubscriptionTokenState {
  // null until loaded — the field stays disabled and the submit treats the token as unchanged.
  current: string | null
  draft: string
  url: string
  loadError: string | null
}

// Same shape as the server's own random tokens (24 random bytes, base64url) — just minted locally so
// "Generate" only fills the field and the actual swap happens on the client form's save.
function generateSubscriptionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function useSubscriptionToken(clientId: number) {
  const t = useT()
  const [state, setState] = React.useState<SubscriptionTokenState>({
    current: null,
    draft: "",
    url: "",
    loadError: null,
  })

  React.useEffect(() => {
    // POST is get-or-create — a client that never opened its QR dialog has no token yet.
    api
      .createSubscriptionToken(clientId)
      .then(({ token, url }) => setState({ current: token, draft: token, url, loadError: null }))
      .catch((err) =>
        setState((s) => ({ ...s, loadError: err instanceof Error ? err.message : t("subscriptionToken.loadFailed") }))
      )
    // `t` is intentionally excluded: switching language must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const setDraft = (draft: string) => setState((s) => ({ ...s, draft }))
  const changed = state.current !== null && state.draft.trim() !== state.current
  return { state, setDraft, changed }
}

export function SubscriptionTokenSection({
  state,
  changed,
  onDraftChange,
}: {
  state: SubscriptionTokenState
  changed: boolean
  onDraftChange: (draft: string) => void
}) {
  const t = useT()
  const loading = state.current === null

  return (
    <SectionGroup title={t("subscriptionToken.title")}>
      <SectionItem position="single">
        <div className="flex w-full flex-col gap-3">
          <TextFieldRow
            label={t("subscriptionToken.tokenLabel")}
            value={state.draft}
            onChange={onDraftChange}
            disabled={loading}
            required={!loading}
            className="font-mono"
            supportingText={changed ? t("subscriptionToken.changedHint") : state.url || t("subscriptionToken.tokenHint")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={loading}
              onClick={() => onDraftChange(generateSubscriptionToken())}
            >
              {t("subscriptionToken.generate")}
            </Button>
          </div>
          {state.loadError && <p className="text-sm text-error">{state.loadError}</p>}
        </div>
      </SectionItem>
    </SectionGroup>
  )
}
