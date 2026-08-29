import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"
import { POPUP_SURFACE } from "@/components/ui/popup-surface"

export interface ComboboxOption {
  value: string
  label: string
}

// A single-value "pick from a list OR type your own" control — the value
// field is a real <input>, and the popover just offers suggestions to
// click. Unlike ./select.tsx (a thin @base-ui/react/select wrapper,
// list-only) this is built on the bare Popover primitive, same as
// ./multi-select.tsx: no existing primitive combines "typeable" with
// "has suggestions".
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
  // A generic ui/ primitive doesn't import the app's i18n hook, so the
  // caller passes translated text in as a plain prop instead.
  noMatchesText?: string
}) {
  const [open, setOpen] = React.useState(false)
  // Base UI's Popover has no Anchor part — the input is a plain element
  // outside the popover's subtree, with its ref passed to Positioner's
  // `anchor` prop. That means a pointerdown/focus back on it still reads
  // as "outside" to the dismiss logic, so onOpenChange below checks the
  // event target against this ref and cancels the close when it's our own input.
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
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          // Matches TextFieldRow's fieldClassName (section.tsx) so every
          // call site looks identical inside a SectionItem. Indicator below
          // is a filled bar, not a border — see TextFieldRow for why.
          className={cn(
            "peer w-full truncate bg-transparent p-4 text-body-large text-on-surface outline-none placeholder:text-on-surface-variant",
            className
          )}
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px rounded-full bg-outline-variant transition-[height,background-color] peer-focus:h-0.5 peer-focus:bg-primary"
        />
      </div>
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
