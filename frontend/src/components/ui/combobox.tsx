import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { POPUP_SURFACE } from "@/components/ui/popup-surface"

export interface ComboboxOption {
  value: string
  label: string
}

// Combobox is a single-value "pick from a list OR type your own" control —
// the value field IS a real <input>, so typing always works; opening the
// popover (on focus, or by typing) just offers suggestions to click
// instead of typing the whole thing out. Unlike ./select.tsx (a thin
// @base-ui/react/select wrapper — list-only, no free text) this is built
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
  // Base UI's Popover has no Anchor part (unlike Radix) — the input is
  // rendered as a plain element outside the popover's own subtree, and its
  // ref is passed to the Positioner's `anchor` prop for positioning. That
  // means a pointerdown/focus landing back on it still reads as "outside"
  // to the popover's dismiss logic, so onOpenChange below checks the
  // triggering event's target against this ref and cancels the close when
  // it's actually our own input, same intent as the old Anchor workaround.
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listboxId = React.useId()

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)
    )
  }, [options, value])

  return (
    <PopoverPrimitive.Root
      open={open && options.length > 0}
      onOpenChange={(nextOpen, eventDetails) => {
        if (
          !nextOpen &&
          (eventDetails.reason === "outside-press" || eventDetails.reason === "focus-out")
        ) {
          const target = eventDetails.event?.target
          if (inputRef.current && target instanceof Node && inputRef.current.contains(target)) {
            eventDetails.cancel()
            return
          }
        }
        setOpen(nextOpen)
      }}
    >
      <Input
        ref={inputRef}
        id={id}
        className={className}
        value={value}
        autoComplete="off"
        required={required}
        role="combobox"
        aria-expanded={open && options.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner anchor={inputRef} align="start" sideOffset={4} className="z-50">
          <PopoverPrimitive.Popup
            initialFocus={false}
            id={listboxId}
            role="listbox"
            className={cn(POPUP_SURFACE, "max-h-64 w-(--anchor-width) overflow-y-auto p-1")}
          >
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-body-medium text-on-surface-variant">{noMatchesText}</p>
            ) : (
              filtered.map((o) => (
                <button
                  type="button"
                  key={o.value}
                  role="option"
                  aria-selected={o.value === value}
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className="state-layer flex w-full items-center rounded-xs px-3 py-2 text-left text-body-large"
                >
                  {o.label}
                </button>
              ))
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { Combobox }
