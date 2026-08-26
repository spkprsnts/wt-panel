import * as React from "react"

import { cn } from "@/lib/utils"

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-label-large text-on-surface select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-[0.38] peer-disabled:cursor-not-allowed peer-disabled:opacity-[0.38]",
        className
      )}
      {...props}
    />
  )
}

export { Label }
