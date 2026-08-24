import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"
import { Check, ChevronDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export interface MultiSelectOption {
  value: string
  label: string
}

// MultiSelect is a fixed-option combobox with removable tag chips in the
// trigger — matches 3x-ui's ALPN picker (antd Select mode="multiple").
// Radix has no multi-select primitive, so this is Popover + a plain
// checkable list rather than an extension of ./select.tsx (that one wraps
// @radix-ui/react-select, which is single-value by design).
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
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className={cn(
            "border-input focus-visible:border-ring focus-visible:ring-ring/50 flex min-h-9 w-full flex-wrap items-center gap-1 rounded-md border bg-transparent px-2 py-1.5 text-sm shadow-xs outline-none focus-visible:ring-[3px]",
            className
          )}
        >
          {value.length === 0 && <span className="text-muted-foreground">{placeholder}</span>}
          {value.map((v) => (
            <span
              key={v}
              className="bg-secondary text-secondary-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
            >
              {options.find((o) => o.value === v)?.label ?? v}
              <X
                className="size-3 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  toggle(v)
                }}
              />
            </span>
          ))}
          <ChevronDown className="ml-auto size-4 opacity-50" />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="bg-popover text-popover-foreground z-50 w-(--radix-popover-trigger-width) min-w-32 rounded-md border p-1 shadow-md"
        >
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
                className="h-8 text-sm"
              />
              <Button type="button" size="sm" className="h-8" onClick={addCustom}>
                +
              </Button>
            </div>
          )}
          {options.map((o) => (
            <button
              type="button"
              key={o.value}
              onClick={() => toggle(o.value)}
              className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
            >
              <span className="flex size-4 items-center justify-center">
                {value.includes(o.value) && <Check className="size-4" />}
              </span>
              {o.label}
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { MultiSelect }
