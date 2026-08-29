import { ToggleButton } from "@/components/ui/toggle-button"
import { useLanguage } from "@/lib/i18n"

// Same ToggleButton shape as theme-toggle.tsx, placed right next to it in
// app-sidebar.tsx's footer — a simple two-state switch (RU/EN), not a
// dropdown, since there are only ever these two languages.
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

  return (
    <ToggleButton
      icon="translate"
      label={language === "ru" ? "English" : "Русский"}
      onClick={toggle}
      showLabel={showLabel}
      className={className}
    />
  )
}
