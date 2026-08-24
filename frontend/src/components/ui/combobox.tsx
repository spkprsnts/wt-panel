import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { Input } from "@/components/ui/input"

export interface ComboboxOption {
  value: string
  label: string
}

// Combobox is a single-value "pick from a list OR type your own" control —
// the value field IS a real <input>, so typing always works; opening the
// popover (on focus, or by typing) just offers suggestions to click
// instead of typing the whole thing out. Unlike ./select.tsx (a thin
// @radix-ui/react-select wrapper — list-only, no free text) this is built
// on the bare Popover primitive, same reasoning as ./multi-select.tsx: no
// existing primitive here combines "typeable" with "has suggestions".
function Combobox({
  options,
  value,
  onChange,
  placeholder,
  id,
  className,
  required,
  noMatchesText = "No matches",
}: {
  options: ComboboxOption[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  id?: string
  className?: string
  required?: boolean
  // A generic ui/ primitive (like Button/Input) doesn't import the app's
  // own i18n hook — same separation every other file in this directory
  // already keeps — so the one bit of built-in copy here is a plain prop
  // the caller passes translated text into instead.
  noMatchesText?: string
}) {
  const [open, setOpen] = React.useState(false)
  // Popover.Anchor (unlike Trigger) doesn't register as part of the
  // popover's own interactive surface, so Radix's dismissable layer treats
  // a pointerdown/focus landing back on our own input as "outside" and
  // closes it the instant it opens — this ref lets onPointerDownOutside/
  // onFocusOutside below recognize "that's actually our anchor" and ignore
  // it, which Anchor-based (non-Trigger) Popover usage is expected to do
  // itself; Radix has no built-in exclusion for Anchor the way it does for
  // Trigger.
  const inputRef = React.useRef<HTMLInputElement>(null)

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    )
  }, [options, value])

  function ignoreIfAnchor(e: { target: EventTarget | null; preventDefault: () => void }) {
    if (inputRef.current && e.target instanceof Node && inputRef.current.contains(e.target)) {
      e.preventDefault()
    }
  }

  return (
    <PopoverPrimitive.Root open={open && options.length > 0} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <Input
          ref={inputRef}
          id={id}
          className={className}
          value={value}
          autoComplete="off"
          required={required}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
        />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerDownOutside={ignoreIfAnchor}
          onFocusOutside={ignoreIfAnchor}
          className="bg-popover text-popover-foreground z-50 max-h-64 w-(--radix-popover-trigger-width) overflow-y-auto rounded-md border p-1 shadow-md"
        >
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">{noMatchesText}</p>
          ) : (
            filtered.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
                className="hover:bg-accent hover:text-accent-foreground flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm"
              >
                {o.label}
              </button>
            ))
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { Combobox }
