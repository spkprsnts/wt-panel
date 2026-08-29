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

// sectionPosition derives a SectionItem's position from its place in a
// dynamic list (see WireTurn's AppExceptionsScreen.kt for the same
// index-driven pattern this ports) — shared so every list-backed
// SectionGroup (ClientsPage's profiles, SettingsPage's config dump, ...)
// computes it identically instead of each re-deriving its own ternary.
function sectionPosition(index: number, length: number): ItemPosition {
  if (length === 1) return "single"
  if (index === 0) return "top"
  if (index === length - 1) return "bottom"
  return "middle"
}

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
  role,
  "aria-checked": ariaChecked,
}: {
  position?: ItemPosition
  onClick?: () => void
  disabled?: boolean
  className?: string
  children: React.ReactNode
  // For a row whose onClick toggles something it contains (e.g. a
  // SwitchRow) — puts the real accessible semantics on this single button
  // instead of the row and its inner control both being separate,
  // redundant tab stops. See SwitchRow's own doc comment.
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

// Meant to live inside a SectionItem whose own onClick does the actual
// toggle (`onClick={() => onCheckedChange(!checked)}`, with
// role="switch"/aria-checked passed to that SectionItem — see its own doc
// comment) — matches WireTurn's shared-interaction-source pattern, where
// SwitchRow never adds a second ripple/click of its own. The inner Switch
// is presentational (tabIndex=-1, aria-hidden): nesting a second real
// role="switch" inside the row's own button would both be invalid HTML
// (no focusable descendants inside <button>) and give keyboard/AT users two
// redundant stops for one control. It still stops its own click from
// bubbling so a direct mouse hit on the thumb doesn't fire the row handler
// twice.
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
  // p-4 (16dp) on every side matches the M3 TextField's own internal
  // content inset exactly — TextFieldImpl.kt's `TextFieldPadding = 16.dp`,
  // applied on all four sides via `contentPaddingWithoutLabel()` since
  // AppComponents.kt's TextFieldRow never passes a `label` composable to
  // the underlying TextField (it has its own separate RowLabel above
  // instead, which — unlike the field — carries no padding of its own).
  // That asymmetry is real and intentional in the source: the label and
  // the field's own text are NOT flush with each other: only the label
  // lines up with the row's outer inset, the value sits 16dp further in.
  //
  // The indicator line below is a filled bar (a sibling div), not a
  // `border-bottom` — a CSS border with radius but zero-width adjacent
  // sides renders as a tapered "whisker" at the corner (the border "ring"
  // has no defined inner edge to round against once the neighbouring side
  // has 0 width), which is not what M3 draws. Compose's own TextField
  // doesn't draw a border either: IndicatorLineNode fills a plain
  // rectangle (`linePath`) and clips it against the field's rounded-rect
  // outline (`linePath and textFieldShapePath`) — a solid fill clipped by
  // a curve, which always ends in a blunt rounded cap, never a point.
  // `rounded-full` on a 1-2px-tall bar reproduces that same blunt cap
  // regardless of the exact corner radius, since any radius at least half
  // the bar's own height already rounds it into a full stadium end.
  // Thickness is NOT constant either: FilledTextFieldTokens has
  // ActiveIndicatorHeight = 1dp at rest, FocusActiveIndicatorHeight = 2dp
  // focused (AppComponents.kt's TextFieldRow uses the stock TextField
  // defaults for this, only overriding colors). Color is
  // border-outline-variant at rest (TextFieldDefaults.colors'
  // unfocusedIndicatorColor — deliberately not on-surface-variant, which
  // is a body-text color and reads far too bright for a resting line),
  // primary focused, error invalid — same three color states, independent
  // of the height change. peer-* variants read all of this off the input/
  // textarea's own state since the bar is a plain sibling, not a wrapper.
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
