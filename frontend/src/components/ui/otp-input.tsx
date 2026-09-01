import * as React from "react"

import { cn } from "@/lib/utils"

interface OtpInputProps {
  id?: string
  "aria-labelledby"?: string
  value: string
  onChange: (value: string) => void
  // Fires once a change (typing the last digit, pasting a full code,
  // editing a digit that leaves the code still fully filled) leaves every
  // box filled — the value it receives is the freshly-computed one, not
  // whatever `value` prop this render closure still holds, so a caller can
  // submit with it immediately instead of waiting a render for state to
  // catch up. Only ever called from an actual input event, never from a
  // passive re-render, so there's no risk of it firing on its own in a loop
  // if a caller leaves a completed-but-wrong code sitting in the boxes.
  onComplete?: (value: string) => void
  length?: number
  autoFocus?: boolean
  disabled?: boolean
}

// Six (or `length`) single-digit boxes standing in for one text field, the
// usual shape for a TOTP/SMS code. Stays a controlled `value`/`onChange`
// pair like a plain Input so call sites don't need to know it's really N
// inputs under the hood.
function OtpInput({
  id,
  "aria-labelledby": ariaLabelledBy,
  value,
  onChange,
  onComplete,
  length = 6,
  autoFocus,
  disabled,
}: OtpInputProps) {
  const inputRefs = React.useRef<(HTMLInputElement | null)[]>([])
  const digits = React.useMemo(() => {
    const chars = value.replace(/\D/g, "").slice(0, length).split("")
    while (chars.length < length) chars.push("")
    return chars
  }, [value, length])

  // A gap-free left-aligned string is the only shape that makes sense for a
  // code that's ultimately submitted as one string — joining stops at the
  // first empty slot instead of naively `.join("")`ing every box, which
  // would silently collapse a gap and shift later digits into it (e.g.
  // clearing digits[1] out of ["1","2","3"] must yield "1", not "13").
  function toValue(arr: string[]): string {
    const filled: string[] = []
    for (const d of arr) {
      if (!d) break
      filled.push(d)
    }
    return filled.join("")
  }

  // Single choke point for pushing a new value out — every mutation below
  // routes through this so onComplete can't be missed or double-fired.
  function commit(next: string) {
    onChange(next)
    if (next.length === length) onComplete?.(next)
  }

  // Handles both a normal one-key press and a browser/OS dropping the whole
  // code into whichever box has focus (autofill, or a paste that lands here
  // instead of firing onPaste) — same "spread from this box onward" logic
  // either way, since maxLength=1 alone doesn't stop either of those.
  function fillFrom(index: number, raw: string) {
    const chars = raw.replace(/\D/g, "").split("")
    if (chars.length === 0) {
      const next = digits.slice()
      next[index] = ""
      commit(toValue(next))
      return
    }
    const next = digits.slice()
    let i = index
    for (const ch of chars) {
      if (i >= length) break
      next[i] = ch
      i++
    }
    commit(toValue(next))
    inputRefs.current[Math.min(i, length - 1)]?.focus()
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      // Clears the previous box too, in this same keystroke, rather than
      // just moving focus there and leaving a second Backspace to clear
      // it — the usual one-keystroke-per-digit expectation. Critically
      // also prevents the native default: without it, the browser's own
      // "delete a character" action fires *after* our synchronous .focus()
      // call already moved focus to the previous box, deleting from that
      // box's now-selected (onFocus below) content instead of a no-op on
      // this already-empty one — confirmed live, this was silently eating
      // an extra digit on every backspace-past-an-empty-box chain.
      e.preventDefault()
      const next = digits.slice()
      next[index - 1] = ""
      commit(toValue(next))
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault()
      inputRefs.current[index - 1]?.focus()
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault()
      inputRefs.current[index + 1]?.focus()
    }
  }

  function handlePaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text")
    if (!/\d/.test(pasted)) return
    e.preventDefault()
    fillFrom(index, pasted)
  }

  return (
    <div role="group" aria-labelledby={ariaLabelledBy} className="flex gap-2">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            inputRefs.current[i] = el
          }}
          id={i === 0 ? id : undefined}
          type="text"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={digit}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => fillFrom(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-14 w-11 rounded-t-xs border-b-2 border-on-surface-variant bg-surface-container-highest text-center text-title-large text-on-surface outline-none transition-colors focus:border-primary disabled:pointer-events-none disabled:opacity-[0.38]"
          )}
        />
      ))}
    </div>
  )
}

export { OtpInput }
