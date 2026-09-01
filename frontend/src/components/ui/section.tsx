import * as React from "react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"

// Ported from WireTurn's ui/AppComponents.kt SectionGroup/SectionItem — a grouped-list shell, no divider lines (see positionShape).
function SectionGroup({
  title,
  className,
  children,
}: {
  title?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {title && (
        <div className="px-2 pt-2 pb-3 text-body-medium font-medium text-primary">{title}</div>
      )}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

type ItemPosition = "top" | "middle" | "bottom" | "single"

// Derives a SectionItem's position from its place in a dynamic list.
function sectionPosition(index: number, length: number): ItemPosition {
  if (length === 1) return "single"
  if (index === 0) return "top"
  if (index === length - 1) return "bottom"
  return "middle"
}

// 20px on the corners facing the group's outer boundary, 4px ("joint") on
// the corners facing a neighboring item.
const positionShape: Record<ItemPosition, string> = {
  top: "rounded-t-large-increased rounded-b-xs",
  middle: "rounded-xs",
  bottom: "rounded-t-xs rounded-b-large-increased",
  single: "rounded-large-increased",
}

function SectionItem({
  position = "middle",
  onClick,
  disabled,
  className,
  children,
  role,
  "aria-checked": ariaChecked,
}: {
  position?: ItemPosition
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
  // For a row whose onClick toggles something it contains (e.g. SwitchRow) — keeps accessible semantics on this one button.
  role?: "switch"
  "aria-checked"?: boolean
}) {
  const classes = cn(
    "flex min-h-18 items-center bg-surface px-4 py-3.5 text-on-surface transition-colors",
    positionShape[position],
    onClick && "state-layer w-full cursor-pointer text-left",
    disabled && "pointer-events-none opacity-[0.38]",
    className
  )

  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        role={role}
        aria-checked={ariaChecked}
      >
        {children}
      </button>
    )
  }

  return <div className={classes}>{children}</div>
}

function RowLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("truncate text-title-medium text-on-surface", className)}>{children}</span>
  )
}

function LabelGroup({
  label,
  supportingText,
  className,
}: {
  label: string
  supportingText?: string
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col justify-center gap-0.5", className)}>
      <RowLabel>{label}</RowLabel>
      {supportingText && (
        <span className="text-body-medium text-on-surface-variant">{supportingText}</span>
      )}
    </div>
  )
}

// Lives inside a SectionItem whose onClick does the actual toggle (role="switch"/aria-checked on that SectionItem). The inner
// Switch is presentational only (tabIndex=-1, aria-hidden) to avoid a redundant nested role="switch", but still stops its own
// click from bubbling so a direct hit on the thumb doesn't double-fire the row.
function SwitchRow({
  label,
  checked,
  onCheckedChange,
  supportingText,
  disabled,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  supportingText?: string
  disabled?: boolean
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <LabelGroup label={label} supportingText={supportingText} className="flex-1" />
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  )
}

type TextFieldRowBaseProps = {
  label: string
  value: string
  onChange: (value: string) => void
  supportingText?: string
  error?: boolean
  trailingIcon?: React.ReactNode
  id?: string
  className?: string
}

type TextFieldRowProps = TextFieldRowBaseProps &
  (
    | ({ multiline: true; rows?: number } & Omit<
        React.ComponentProps<"textarea">,
        "onChange" | "value" | "id" | "className"
      >)
    | ({ multiline?: false } & Omit<
        React.ComponentProps<"input">,
        "onChange" | "value" | "id" | "className"
      >)
  )

// Meant to live inside a SectionItem. Not the Input/Textarea components — label sits above (never floating), field has no fill,
// just a bottom indicator line, since SectionItem's own surface background already does the containment.
function TextFieldRow({
  label,
  value,
  onChange,
  supportingText,
  error,
  trailingIcon,
  id,
  className,
  multiline,
  ...props
}: TextFieldRowProps) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  // p-4 matches M3 TextField's own inset (label sits flush above, field value 16dp further in, matching the Compose source).
  // Indicator is a filled div, not border-bottom, so rounded-full gives M3's blunt cap instead of a bordered rect's taper.
  const fieldClassName = cn(
    "peer w-full bg-transparent p-4 text-body-large text-on-surface outline-none placeholder:text-on-surface-variant disabled:pointer-events-none disabled:opacity-[0.38]",
    !multiline && "truncate",
    className
  )
  const indicatorClassName =
    "pointer-events-none absolute inset-x-0 bottom-0 h-px rounded-full bg-outline-variant transition-[height,background-color] peer-focus:h-0.5 peer-focus:bg-primary peer-aria-invalid:bg-error peer-disabled:opacity-[0.38]"

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={inputId} className="text-title-medium text-on-surface">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          {multiline ? (
            <textarea
              id={inputId}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={error}
              className={fieldClassName}
              {...(props as React.ComponentProps<"textarea">)}
            />
          ) : (
            <input
              id={inputId}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              aria-invalid={error}
              className={fieldClassName}
              {...(props as React.ComponentProps<"input">)}
            />
          )}
          <div aria-hidden="true" className={indicatorClassName} />
        </div>
        {trailingIcon}
      </div>
      {supportingText && (
        <span className={cn("text-body-small text-on-surface-variant", error && "text-error")}>
          {supportingText}
        </span>
      )}
    </div>
  )
}

export {
  SectionGroup,
  SectionItem,
  RowLabel,
  LabelGroup,
  SwitchRow,
  TextFieldRow,
  sectionPosition,
  type ItemPosition,
}
