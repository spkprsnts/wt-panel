import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export interface MultiSelectOption {
  value: string
  label: string
}

// MultiSelect is a fixed-option combobox with removable tag chips in the
// trigger — matches 3x-ui's ALPN picker (antd Select mode="multiple").
// Base UI has no multi-select primitive, so this is Popover + a plain
// checkable list rather than an extension of ./select.tsx (that one wraps
// @base-ui/react/select, which is single-value by design). No M3 spec
// covers this control either; the trigger borrows Input's filled-field
// visual language and the popup matches select.tsx/dropdown-menu.tsx's
// M3 menu styling, with M3 input chips for the selected tags.
//
// allowCustom (default true) additionally shows a text input at the top of
// the popover so a value that isn't in `options` can be added too — the
// list alone used to be the only way in (e.g. ALPN could only ever be one
// of three presets), which doesn't fit every use of this component: a
// profile's call ids, for one, are arbitrary strings the operator pastes
// in, with `options` only offering ones already saved to the room journal
// as shortcuts.
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
  // Same reasoning as Combobox's noMatchesText: a generic ui/ primitive
  // doesn't import the app's own i18n hook, so this one bit of built-in
  // copy is a plain prop instead.
  customValuePlaceholder?: string
  // Accessible names for the icon-only chip-remove and add-custom-value
  // buttons — neither has visible text, so without these a screen reader
  // announces an unlabeled button.
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
      {/* nativeButton=false + a <div> render: the chip pills below each need
          their own real, independently focusable remove <button> — nesting
          one inside a real <button> (the previous render) is invalid HTML
          (no interactive descendants allowed) and made the remove control
          unreachable by keyboard/AT. Base UI still gives this div the same
          role="button"/tabIndex/keyboard-activation behavior. */}
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
        <PopoverPrimitive.Positioner align="start" sideOffset={4}>
          <PopoverPrimitive.Popup className="z-50 w-(--anchor-width) min-w-32 rounded-xs bg-surface-container p-1 text-on-surface shadow-elevation-2">
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
