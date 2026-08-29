import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/icon"

// KeyField is a text field with a "Generate" action shared by every
// crypto-key/secret input in the app (Turnable's keypair, olcRTC's crypto
// key, FreeTurn's obfuscation key, Reality/WireGuard keys, ...) — was
// duplicated near-verbatim between profile-form.tsx and XrayPage.tsx before
// this got pulled out. The generate action is a plain icon button sitting
// inside the field's own box (right edge), not a separate pill button next
// to it — a standalone Button next to a 56px filled M3 field never matched
// its height/shape and stuck out. A generic ui/ primitive doesn't import
// the app's own i18n hook (same separation as Combobox/MultiSelect's own
// copy props), so the accessible label is a plain prop callers pass
// translated text into.
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
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="pr-12 font-mono text-xs"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 -translate-y-1/2"
          onClick={handleGenerate}
          disabled={generating}
          title={generateLabel}
          aria-label={generateLabel}
        >
          <Icon name="refresh" size={20} className={generating ? "animate-spin" : undefined} />
        </Button>
      </div>
      {genError && <p className="text-xs text-error">{genError}</p>}
    </div>
  )
}

export { KeyField }
