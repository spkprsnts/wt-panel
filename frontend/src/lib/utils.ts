import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

import type { Language } from "@/lib/i18n"

// Plain twMerge doesn't know the M3 type-scale utilities defined in
// index.css (text-display-large..text-label-small, @utility, not part of
// Tailwind's theme) — it falls back to treating any unrecognized
// `text-{word}` class as a text-color utility, so e.g.
// `cn("text-label-large", "text-on-primary")` would silently drop
// text-label-large as a "conflicting" color class. Registering them under
// Tailwind's own font-size group fixes that.
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

// Maps the app's two-value Language to an Intl locale tag, shared by
// formatDateTime/formatDateOnly so dates follow the operator's chosen
// language instead of some pages hardcoding "ru-RU" or falling back to the
// browser's own locale.
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
