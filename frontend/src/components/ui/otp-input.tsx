import * as React from "react"

import { cn } from "@/lib/utils"

interface OtpInputProps {
  id?: string
  "aria-labelledby"?: string
  value: string
  onChange: (value: string) => void
  // Fires with the fresh value when a change leaves every box filled — only from real input events, never a passive re-render.
  onComplete?: (value: string) => void
  length?: number
  autoFocus?: boolean
  disabled?: boolean
}

// `length` single-digit boxes standing in for one text field, controlled as a plain value/onChange pair like Input.
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

  // Stops at the first empty slot instead of joining every box, which would collapse a gap (["1","","3"] must yield "1", not "13").
  function toValue(arr: string[]): string {
    const filled: string[] = []
    for (const d of arr) {
      if (!d) break
      filled.push(d)
    }
    return filled.join("")
  }

  // Single choke point for pushing a new value out so onComplete can't be missed or double-fired.
  function commit(next: string) {
    onChange(next)
    if (next.length === length) onComplete?.(next)
  }

  // Handles a normal keypress and a browser/OS dropping the whole code into whichever box has focus (autofill, or a paste that
  // lands here instead of firing onPaste) — maxLength=1 alone doesn't stop either, so both spread from this box onward.
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
      // preventDefault is required: without it the browser's native delete fires after our .focus() call, deleting from the
      // newly-focused previous box instead of being a no-op here.
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
