import * as React from "react"

import { cn } from "@/lib/utils"

interface InputProps extends React.ComponentProps<"input"> {
  /**
   * Renders an M3 floating label inside the field. Omit to keep using an
   * external `<Label>` above the field (today's pattern on every page) —
   * the field still gets the M3 filled-field treatment either way.
   */
  label?: string
}

function Input({ className, type, label, id, placeholder, ref, ...props }: InputProps) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId

  const field = (
    <input
      ref={ref}
      id={inputId}
      type={type}
      data-slot="input"
      placeholder={label ? " " : placeholder}
      className={cn(
        "peer h-14 w-full min-w-0 rounded-t-xs border-b-2 border-on-surface-variant bg-surface-container-highest px-4 text-body-large text-on-surface transition-colors outline-none placeholder:text-transparent selection:bg-primary selection:text-on-primary focus:border-primary disabled:pointer-events-none disabled:opacity-[0.38] aria-invalid:border-error",
        label ? "pt-5 pb-1" : "py-3.5",
        className
      )}
      {...props}
    />
  )

  if (!label) return field

  return (
    <div className="relative">
      {field}
      <label
        htmlFor={inputId}
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-body-large text-on-surface-variant transition-all peer-focus:top-2.5 peer-focus:text-label-small peer-focus:text-primary peer-not-placeholder-shown:top-2.5 peer-not-placeholder-shown:text-label-small peer-not-placeholder-shown:text-on-surface-variant"
      >
        {label}
      </label>
    </div>
  )
}

export { Input }
