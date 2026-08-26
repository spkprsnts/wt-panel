import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"

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
        "flex w-fit items-center justify-between gap-2 rounded-t-xs border-b-2 border-on-surface-variant bg-surface-container-highest px-4 text-body-large whitespace-nowrap text-on-surface transition-colors outline-none data-placeholder:text-on-surface-variant focus-visible:border-primary disabled:pointer-events-none disabled:opacity-[0.38] aria-invalid:border-error data-[size=default]:h-14 data-[size=sm]:h-10 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon render={<Icon name="keyboard_arrow_down" className="text-on-surface-variant" />} />
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
            "relative max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-xs bg-surface-container text-on-surface shadow-elevation-2 transition-all data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List className="h-(--anchor-height) w-full min-w-(--anchor-width) scroll-my-1 p-1">
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
        "state-layer relative flex w-full cursor-default items-center gap-2 rounded-xs py-2 pr-8 pl-3 text-body-large outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-[0.38]",
        className
      )}
      {...props}
    >
      <span className="absolute right-2 flex size-4 items-center justify-center text-primary">
        <SelectPrimitive.ItemIndicator>
          <Icon name="check" size={18} />
        </SelectPrimitive.ItemIndicator>
      </span>
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
