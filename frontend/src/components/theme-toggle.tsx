import * as React from "react"
import { Moon, Sun } from "lucide-react"

import { cn } from "@/lib/utils"
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
  const [theme, setThemeState] = React.useState<Theme>(() => getEffectiveTheme())

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark"
    setTheme(next)
    setThemeState(next)
  }

  const Icon = theme === "dark" ? Sun : Moon
  const label = theme === "dark" ? "Светлая тема" : "Тёмная тема"

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={cn(showLabel && "w-full justify-start gap-3", className)}
      onClick={toggle}
      title={label}
    >
      <Icon className="size-4 shrink-0" />
      {showLabel && label}
    </Button>
  )
}
