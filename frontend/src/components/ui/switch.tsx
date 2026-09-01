import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

// Content box (52px track - 2*2px border - 2*4px padding) is 40px wide; thumb sits flush start when unchecked, flush end when checked.
const TRACK_CONTENT_WIDTH = 40
const THUMB_UNCHECKED_SIZE = 16
const THUMB_CHECKED_SIZE = 24

function Switch({ className, checked, ...props }: SwitchPrimitive.Root.Props) {
  const reduceMotion = useReducedMotion()

  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      checked={checked}
      className={cn(
        "group state-layer peer inline-flex h-8 w-13 shrink-0 items-center rounded-full border-2 px-1 transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary data-checked:bg-primary data-unchecked:border-outline data-unchecked:bg-surface-container-highest data-disabled:pointer-events-none data-disabled:opacity-[0.38]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        render={
          <motion.span
            // Not `layout` mode: it FLIP-diffs getBoundingClientRect() snapshots, so an unrelated ancestor reflow also springs
            // the thumb. Animating literal x/width/height never measures the page, so there's nothing to spuriously correct.
            animate={{
              x: checked ? TRACK_CONTENT_WIDTH - THUMB_CHECKED_SIZE : 0,
              width: checked ? THUMB_CHECKED_SIZE : THUMB_UNCHECKED_SIZE,
              height: checked ? THUMB_CHECKED_SIZE : THUMB_UNCHECKED_SIZE,
            }}
            // M3 Expressive "default spatial" spring (stiffness 380, dampingRatio 0.8; see button.tsx for the conversion).
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 380, damping: 31 }
            }
          />
        }
        className="pointer-events-none relative rounded-full"
      >
        <span
          // Painted circle plus a momentary pressed grow (AndroidX's pressed-handle-size); uses scale, not width/height, so it
          // can't fight the motion-owned box above.
          className={cn(
            "absolute inset-0 rounded-full transition-transform duration-150",
            checked ? "bg-on-primary group-active:scale-[1.16667]" : "bg-outline group-active:scale-125"
          )}
        />
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
