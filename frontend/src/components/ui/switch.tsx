import { Switch as SwitchPrimitive } from "@base-ui/react/switch"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

// Track geometry (h-8 w-13 border-2 px-1 below): 32px tall, 52px wide, 2px
// border, 4px horizontal padding each side — content box is 52-2*2-2*4 =
// 40px wide. The thumb sits flush against that box's start when unchecked
// (x: 0) and flush against its end when checked (x: 40 - 24 = 16, the
// checked thumb being 24px wide).
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
            // Deliberately not `layout` — that mode animates by comparing
            // getBoundingClientRect() snapshots across renders (FLIP), so
            // it can't tell "this switch's own checked state changed" apart
            // from "this switch's ancestor moved for an unrelated reason"
            // (fields appearing/disappearing elsewhere reflow the row).
            // Both look like "the rect changed" to it, so it springs the
            // thumb to catch up either way — confirmed still happening
            // even with layoutDependency scoping (which only gates whether
            // the *animation* starts, not FLIP's own remeasuring, so a
            // concurrent scroll/reflow during a genuine checked-change
            // could still measure a stale rect and animate to a leftover
            // position for a frame). Animating literal `x`/`width`/`height`
            // values instead never measures the page at all — the browser's
            // normal reflow moves the element the instant its ancestor
            // does, with nothing for Motion to "correct".
            animate={{
              x: checked ? TRACK_CONTENT_WIDTH - THUMB_CHECKED_SIZE : 0,
              width: checked ? THUMB_CHECKED_SIZE : THUMB_UNCHECKED_SIZE,
              height: checked ? THUMB_CHECKED_SIZE : THUMB_UNCHECKED_SIZE,
            }}
            // M3 Expressive "default spatial" spring (stiffness 380,
            // dampingRatio 0.8) — see button.tsx's press spring for the
            // dampingRatio-to-damping conversion.
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
          // The actual painted circle, and the momentary "pressed" grow
          // (AndroidX Switch's pressed-handle-size, toned down from its
          // literal 28px here — a flat 28px reads as a much bigger jump off
          // the 16px unchecked resting size than off the 24px checked one)
          // while the track is held — done as a `scale` transform instead
          // of a real width/height change, since transform never touches
          // layout, so it can't fight with (or get overridden by) the
          // motion-owned box above the way an actual size change did.
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
