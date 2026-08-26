import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  const reduceMotion = useReducedMotion()

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "state-layer peer inline-flex h-8 w-13 shrink-0 items-center rounded-full border-2 px-1 transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-checked:bg-primary data-unchecked:border-outline data-unchecked:bg-surface-container-highest data-disabled:pointer-events-none data-disabled:opacity-[0.38]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        render={
          <motion.span
            layout
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 500, damping: 30 }
            }
          />
        }
        className="pointer-events-none rounded-full transition-colors data-unchecked:size-4 data-unchecked:bg-outline data-checked:ml-auto data-checked:size-6 data-checked:bg-on-primary"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
