import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"
import { POPUP_SURFACE } from "@/components/ui/popup-surface"

const Select = SelectPrimitive.Root

function SelectValue({ ...props }: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        // px-4 matches TextFieldRow's 16dp content inset (section.tsx).
        // `group` here + the indicator <div> below match TextFieldRow's
        // filled-bar indicator (see section.tsx for why it's a bar, not a
        // border).
        "group relative flex w-fit items-center justify-between gap-2 bg-transparent px-4 text-body-large whitespace-nowrap text-on-surface outline-none data-placeholder:text-on-surface-variant disabled:pointer-events-none disabled:opacity-[0.38] data-[size=default]:h-14 data-[size=sm]:h-10 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<Icon name="keyboard_arrow_down" className="text-on-surface-variant" />} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px rounded-full bg-outline-variant transition-[height,background-color] group-focus-visible:h-0.5 group-focus-visible:bg-primary group-aria-invalid:bg-error group-disabled:opacity-[0.38]"
      />
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner alignItemWithTrigger={false} sideOffset={4} className="z-50">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            POPUP_SURFACE,
            "relative max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto transition-all data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List className="w-full min-w-(--anchor-width) scroll-my-1 p-1">
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "state-layer relative flex w-full cursor-default items-center gap-2 rounded-xs px-3 py-2 text-body-large outline-hidden select-none data-selected:bg-tertiary-container data-selected:text-on-tertiary-container data-disabled:pointer-events-none data-disabled:opacity-[0.38]",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

export {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
}
