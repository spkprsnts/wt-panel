import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/lib/i18n"

// Same Button-based toggle shape as theme-toggle.tsx, placed right next to
// it in app-sidebar.tsx's footer — a simple two-state switch (RU/EN), not
// a dropdown, since there are only ever these two languages.
export function LanguageToggle({
  className,
  showLabel = false,
}: {
  className?: string
  showLabel?: boolean
}) {
  const [language, setLanguage] = useLanguage()

  function toggle() {
    setLanguage(language === "ru" ? "en" : "ru")
  }

  const label = language === "ru" ? "English" : "Русский"

  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={cn(showLabel && "w-full justify-start gap-3", className)}
      onClick={toggle}
      title={label}
    >
      <Icon name="translate" size={20} className="shrink-0" />
      {showLabel && label}
    </Button>
  )
}
