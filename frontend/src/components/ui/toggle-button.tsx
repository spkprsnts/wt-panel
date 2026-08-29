import { cn } from "@/lib/utils"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"

// ToggleButton is the shared shell behind every simple two-state sidebar
// switch (ThemeToggle, LanguageToggle) — was duplicated near-verbatim
// between them before this got pulled out. showLabel toggles between the
// icon-only rail button (collapsed sidebar) and the full label+icon row
// (expanded sidebar footer).
function ToggleButton({
  icon,
  label,
  onClick,
  showLabel,
  className,
}: {
  icon: string
  label: string
  onClick: () => void
  showLabel?: boolean
  className?: string
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      className={cn(showLabel && "w-full justify-start gap-3", className)}
      onClick={onClick}
      title={label}
    >
      <Icon name={icon} size={20} className="shrink-0" />
      {showLabel && label}
    </Button>
  )
}

export { ToggleButton }
