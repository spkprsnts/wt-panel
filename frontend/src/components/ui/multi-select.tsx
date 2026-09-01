import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { POPUP_SURFACE } from "@/components/ui/popup-surface"

export interface MultiSelectOption {
  value: string
  label: string
}

// A fixed-option combobox with removable tag chips in the trigger, matching 3x-ui's ALPN picker. Base UI has no multi-select
// primitive, so this is Popover + a checkable list, not an extension of ./select.tsx (single-value by design).
// allowCustom (default true) adds a text input for values outside `options`, e.g. a profile's arbitrary pasted call ids.
function MultiSelect({
  options,
  value,
  onChange,
  placeholder,
  className,
  allowCustom = true,
  customValuePlaceholder = "Custom value...",
  removeOptionLabel = (label) => `Remove ${label}`,
  addCustomValueLabel = "Add",
}: {
  options: MultiSelectOption[]
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
  className?: string
  allowCustom?: boolean
  // No i18n hook in a generic ui/ primitive, so translated text comes in as a plain prop (same as Combobox's noMatchesText).
  customValuePlaceholder?: string
  // Accessible names for the icon-only chip-remove and add-custom-value buttons.
  removeOptionLabel?: (label: string) => string
  addCustomValueLabel?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [customValue, setCustomValue] = React.useState("")

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  function addCustom() {
    const v = customValue.trim()
    if (v && !value.includes(v)) onChange([...value, v])
    setCustomValue("")
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      {/* nativeButton=false + <div> render: chip remove <button>s need to be independently focusable, and nesting a
          <button> inside a <button> is invalid HTML. Base UI still gives the div the same role/tabIndex/keyboard behavior. */}
      <PopoverPrimitive.Trigger
        nativeButton={false}
        render={
          <div
            className={cn(
              "flex min-h-14 w-full flex-wrap items-center gap-1.5 rounded-t-xs border-b-2 border-on-surface-variant bg-surface-container-highest px-4 py-2.5 text-body-large text-on-surface transition-colors outline-none focus-visible:border-primary",
              className
            )}
          />
        }
      >
        {value.length === 0 && <span className="text-on-surface-variant">{placeholder}</span>}
        {value.map((v) => {
          const label = options.find((o) => o.value === v)?.label ?? v
          return (
            <span
              key={v}
              className="flex items-center gap-1 rounded-sm bg-secondary-container px-2 py-1 text-label-large text-on-secondary-container"
            >
              {label}
              <button
                type="button"
                aria-label={removeOptionLabel(label)}
                className="cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(v)
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </span>
          )
        })}
        <Icon name="keyboard_arrow_down" className="ml-auto text-on-surface-variant" />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner align="start" sideOffset={4} className="z-50">
          <PopoverPrimitive.Popup className={cn(POPUP_SURFACE, "w-(--anchor-width) min-w-32 p-1")}>
            {allowCustom && (
              <div className="flex gap-1 p-1">
                <Input
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addCustom()
                    }
                  }}
                  placeholder={customValuePlaceholder}
                  className="h-10"
                />
                <Button
                  type="button"
                  size="sm"
                  className="h-10"
                  onClick={addCustom}
                  aria-label={addCustomValueLabel}
                >
                  <Icon name="add" size={18} />
                </Button>
              </div>
            )}
            {options.map((o) => (
              <button
                type="button"
                key={o.value}
                onClick={() => toggle(o.value)}
                className="state-layer flex w-full items-center gap-2 rounded-xs px-3 py-2 text-left text-body-large"
              >
                <span className="flex size-4 items-center justify-center text-primary">
                  {value.includes(o.value) && <Icon name="check" size={18} />}
                </span>
                {o.label}
              </button>
            ))}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { MultiSelect }
