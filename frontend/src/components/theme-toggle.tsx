import * as React from "react"

import { useT } from "@/lib/i18n"
import { ToggleButton } from "@/components/ui/toggle-button"
import { getEffectiveTheme, setTheme, type Theme } from "@/lib/theme"

// Reads the theme already set by index.html's inline bootstrap script (lib/theme.ts) so the icon never flashes the wrong state.
export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  const t = useT()
  const [theme, setThemeState] = React.useState<Theme>(() => getEffectiveTheme())

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    setTheme(next)
    setThemeState(next)
  }

  return (
    <ToggleButton
      icon={theme === "dark" ? "light_mode" : "dark_mode"}
      label={theme === "dark" ? t("themeToggle.light") : t("themeToggle.dark")}
      onClick={toggle}
      showLabel={showLabel}
      className={className}
    />
  )
}
