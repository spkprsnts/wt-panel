import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// Plain twMerge doesn't know about the M3 type-scale utilities defined in
// index.css (text-display-large..text-label-small, @utility, not part of
// Tailwind's own theme) — it falls back to treating any unrecognized
// `text-{word}` class as a *text-color* utility, so e.g.
// `cn("text-label-large", "text-on-primary")` silently drops
// text-label-large as a "conflicting" color class, leaving the element
// with no font-size/line-height/letter-spacing/weight of its own (it just
// inherits body's text-body-large). Registering them under the same
// group Tailwind's own text-size utilities use keeps them deduped against
// each other but no longer against text-color utilities.
const M3_TYPE_SCALE = [
  "display-large", "display-medium", "display-small",
  "headline-large", "headline-medium", "headline-small",
  "title-large", "title-medium", "title-small",
  "body-large", "body-medium", "body-small",
  "label-large", "label-medium", "label-small",
]

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: M3_TYPE_SCALE }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
