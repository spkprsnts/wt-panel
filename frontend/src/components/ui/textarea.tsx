import * as React from "react"

import { cn } from "@/lib/utils"

interface TextareaProps extends React.ComponentProps<"textarea"> {
  /** See Input's `label` prop — same optional floating-label pattern. */
  label?: string
}

function Textarea({ className, label, id, placeholder, ...props }: TextareaProps) {
  const generatedId = React.useId()
  const textareaId = id ?? generatedId

  const field = (
    <textarea
      id={textareaId}
      data-slot="textarea"
      placeholder={label ? " " : placeholder}
      className={cn(
        "peer min-h-16 w-full rounded-t-xs border-b-2 border-outline bg-surface-container-highest px-4 py-3.5 text-body-large text-on-surface transition-colors outline-none placeholder:text-transparent selection:bg-primary selection:text-on-primary focus:border-primary disabled:pointer-events-none disabled:opacity-[0.38] aria-invalid:border-error",
        label && "pt-5 pb-1",
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
        htmlFor={textareaId}
        className="pointer-events-none absolute top-3.5 left-4 text-body-large text-on-surface-variant transition-all peer-focus:text-label-small peer-focus:text-primary peer-not-placeholder-shown:text-label-small peer-not-placeholder-shown:text-on-surface-variant"
      >
        {label}
      </label>
    </div>
  )
}

export { Textarea }
