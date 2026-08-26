import * as React from "react"

import { cn } from "@/lib/utils"

interface IconProps extends React.ComponentProps<"span"> {
  /** Material Symbols glyph name, e.g. "settings", "dashboard". */
  name: string
  /** Filled glyph variant — typically used for the active/selected state. */
  filled?: boolean
  weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700
  size?: number
}

/** Material Symbols icon (self-hosted variable font, see index.css). */
function Icon({ name, filled = false, weight = 400, size = 24, className, style, ...props }: IconProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("material-symbols-outlined select-none", className)}
      style={{
        fontSize: size,
        fontVariationSettings: `'FILL' ${filled ? 1 : 0}, 'wght' ${weight}, 'GRAD' 0, 'opsz' ${size}`,
        ...style,
      }}
      {...props}
    >
      {name}
    </span>
  )
}

export { Icon }
