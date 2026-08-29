// A plain "light"/"dark" choice, no third "system" option. The first visit
// (nothing saved) respects the OS preference as a starting point; every
// visit after an explicit toggle uses whatever was saved instead.
export type Theme = "light" | "dark"

const THEME_KEY = "wtpanel_theme"

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === "light" || v === "dark" ? v : null
  } catch {
    return null
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
}

export function getEffectiveTheme(): Theme {
  return getStoredTheme() ?? (systemPrefersDark() ? "dark" : "light")
}

// Only touches the DOM class — same mechanism the inline bootstrap script
// in index.html uses before React mounts, so the page never flashes the
// wrong theme on load.
export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark")
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // ignore — theme still applies for this page view, just won't persist
  }
  applyTheme(theme)
}
