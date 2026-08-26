import * as React from "react"

import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { getEffectiveTheme, setTheme, type Theme } from "@/lib/theme"

// Reads the currently-applied theme (already set synchronously by
// index.html's inline bootstrap script before React even mounts — see
// lib/theme.ts) rather than defaulting to "light" and correcting itself,
// so the icon never flashes the wrong state either.
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

  const iconName = theme === "dark" ? "light_mode" : "dark_mode"
  const label = theme === "dark" ? t("themeToggle.light") : t("themeToggle.dark")

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={cn(showLabel && "w-full justify-start gap-3", className)}
      onClick={toggle}
      title={label}
    >
      <Icon name={iconName} size={20} className="shrink-0" />
      {showLabel && label}
    </Button>
  )
}
