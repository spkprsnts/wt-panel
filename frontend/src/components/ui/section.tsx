import * as React from "react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/ui/switch"

// Ported from WireTurn's ui/AppComponents.kt SectionGroup/SectionItem — the
// grouped-list shell the Android app uses for every settings-style form and
// dynamic list (first/last item gets the outer 20px corner, everything else
// joins at a near-flat 4px corner, no divider lines). See section.tsx's
// SectionItem below for the exact corner table.

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

// 20px on the corners that face the group's outer boundary, 4px ("joint")
// on the corners facing a neighboring item — matches SectionItem's
// Top/Middle/Bottom/Single cornerSize(20dp)/smallCornerSize(4dp) split.
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
}: {
  position?: ItemPosition
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
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
      <button type="button" className={classes} onClick={onClick} disabled={disabled}>
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

// Meant to live inside a SectionItem whose own onClick does the actual
// toggle (`onClick={() => onCheckedChange(!checked)}`) — matches WireTurn's
// shared-interaction-source pattern, where SwitchRow never adds a second
// ripple/click of its own. The inner Switch still stops its click from
// bubbling so a direct hit on the thumb doesn't fire the row handler twice.
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

// Meant to live inside a SectionItem. Deliberately not the `Input`/
// `Textarea` components — WireTurn's TextFieldRow (which handles both
// single- and multi-line fields via the same composable, see its
// singleLine/minLines/maxLines params) has a different chrome entirely:
// the label sits above the field (never floating) and the field itself
// carries no fill, only a bottom indicator line, since SectionItem's own
// `surface` background already does the containment job.
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
  const fieldClassName = cn(
    "w-full border-b-2 border-on-surface-variant bg-transparent py-1 text-body-large text-on-surface outline-none transition-colors placeholder:text-on-surface-variant focus:border-primary disabled:pointer-events-none disabled:opacity-[0.38] aria-invalid:border-error",
    !multiline && "truncate",
    className
  )

  return (
    <div className="flex w-full flex-col gap-1">
      <label htmlFor={inputId} className="text-title-medium text-on-surface">
        {label}
      </label>
      <div className="flex items-center gap-2">
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

export { SectionGroup, SectionItem, RowLabel, LabelGroup, SwitchRow, TextFieldRow, type ItemPosition }
