import * as React from "react"

import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"

// KeyField is a text field with a "Generate" action shared by every
// crypto-key/secret input in the app (Turnable's keypair, olcRTC's crypto
// key, FreeTurn's obfuscation key, Reality/WireGuard keys, ...) — was
// duplicated near-verbatim between profile-form.tsx and XrayPage.tsx before
// this got pulled out. Every call site lives inside a SectionItem now, so
// the field itself intentionally matches TextFieldRow's chrome exactly —
// see that component's own doc comment in section.tsx for the filled-bar
// indicator / 16dp-content-padding reasoning, all read off WireTurn's own
// TextFieldRow (AppComponents.kt). pr-12 (instead of the usual pr-4) is the
// one deviation, reserved so the generate button sitting inside the
// field's own right edge doesn't overlap the text. Also matches WireTurn
// in never singling out key/technical fields with a monospace font.
function KeyField({
  id,
  label,
  value,
  onChange,
  onGenerate,
  placeholder,
  generateLabel,
  generateFailedLabel,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  onGenerate: () => Promise<unknown>
  placeholder?: string
  generateLabel: string
  generateFailedLabel: string
}) {
  const [generating, setGenerating] = React.useState(false)
  const [genError, setGenError] = React.useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      await onGenerate()
    } catch (err) {
      setGenError(err instanceof Error ? err.message : generateFailedLabel)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={id} className="text-title-medium text-on-surface">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="peer w-full truncate bg-transparent py-4 pr-12 pl-4 text-body-large text-on-surface outline-none placeholder:text-on-surface-variant"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px rounded-full bg-outline-variant transition-[height,background-color] peer-focus:h-0.5 peer-focus:bg-primary"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-0 -translate-y-1/2"
          onClick={handleGenerate}
          disabled={generating}
          title={generateLabel}
          aria-label={generateLabel}
        >
          <Icon name="refresh" size={20} className={generating ? "animate-spin" : undefined} />
        </Button>
      </div>
      {genError && <p className="text-body-small text-error">{genError}</p>}
    </div>
  )
}

export { KeyField }
