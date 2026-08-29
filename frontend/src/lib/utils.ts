import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

import type { Language } from "@/lib/i18n"

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

// formatBytes scales a byte count up through `units` (e.g. ["Б", "КБ",
// "МБ", ...], translated per-caller since this is a generic helper, not an
// i18n one) by 1024 until it fits in three digits or runs out of units. No
// decimal at the base unit (an exact byte count, e.g. "512 Б") but one
// decimal once scaled (e.g. "1.5 МБ" — precision that actually matters once
// the number itself has been rounded).
// localeFor maps the app's own two-value Language to an actual Intl locale
// tag — shared by formatDateTime/formatDateOnly below so every date shown
// in the panel follows the operator's chosen language (via the sidebar's
// LanguageToggle) instead of some pages hardcoding "ru-RU" and others
// falling back to the browser's own locale regardless of it.
function localeFor(language: Language): string {
  return language === "ru" ? "ru-RU" : "en-US"
}

export function formatDateTime(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(localeFor(language))
}

export function formatDateOnly(value: string | number, language: Language): string {
  return new Date(value).toLocaleDateString(localeFor(language))
}

export function formatBytes(bytes: number, units: string[]): string {
  if (!bytes) return `0 ${units[0]}`
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
