import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

import type { Language } from "@/lib/i18n"

// Plain twMerge treats unrecognized text-{word} classes as text-color utilities, so it would drop index.css's M3 type-scale
// classes (text-display-large etc.) as "conflicting" with a real color class. Registering them under font-size fixes that.
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

// Shared by formatDateTime/formatDateOnly so dates follow the operator's chosen language, not the browser's own locale.
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
