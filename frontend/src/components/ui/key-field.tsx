import * as React from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"

// KeyField is a text field + "Generate" button pair shared by every
// crypto-key/secret input in the app (Turnable's keypair, olcRTC's crypto
// key, FreeTurn's obfuscation key, Reality/WireGuard keys, ...) — was
// duplicated near-verbatim between profile-form.tsx and XrayPage.tsx before
// this got pulled out. A generic ui/ primitive doesn't import the app's own
// i18n hook (same separation as Combobox/MultiSelect's own copy props), so
// every bit of built-in text is a plain prop callers pass translated
// strings into.
function KeyField({
  id,
  label,
  value,
  onChange,
  onGenerate,
  placeholder,
  generateLabel,
  generatingLabel,
  generateFailedLabel,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  onGenerate: () => Promise<unknown>
  placeholder?: string
  generateLabel: string
  generatingLabel: string
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
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
          {generating ? generatingLabel : generateLabel}
        </Button>
      </div>
      {genError && <p className="text-xs text-error">{genError}</p>}
    </div>
  )
}

export { KeyField }
