import * as React from "react"
import { NavLink, useNavigate } from "react-router-dom"
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  Video,
  Boxes,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react"

import { api, clearToken } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import type { TranslationKey } from "@/i18n"

const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: typeof LayoutDashboard }[] = [
  { to: "/dashboard", labelKey: "sidebar.nav.dashboard", icon: LayoutDashboard },
  { to: "/clients", labelKey: "sidebar.nav.clients", icon: Users },
  { to: "/xray", labelKey: "sidebar.nav.xray", icon: ShieldCheck },
  { to: "/rooms", labelKey: "sidebar.nav.rooms", icon: Video },
  { to: "/kernels", labelKey: "sidebar.nav.kernels", icon: Boxes },
  { to: "/settings", labelKey: "sidebar.nav.settings", icon: Settings },
]

const COLLAPSE_KEY = "wtpanel_sidebar_collapsed"

export function AppSidebar() {
  const t = useT()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1"
    } catch {
      return false
    }
  })
  const [version, setVersion] = React.useState<string | null>(null)

  React.useEffect(() => {
    api
      .getSettings()
      .then((s) => setVersion(s.version))
      .catch(() => {})
  }, [])

  function toggleCollapsed() {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      } catch {
        // ignore
      }
      return next
    })
  }

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  return (
    <aside
      className={cn(
        "flex h-svh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-3">
        {!collapsed && <span className="truncate font-semibold">wt-panel</span>}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-8"
          onClick={toggleCollapsed}
          title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </Button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
        {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )
            }
            title={collapsed ? t(labelKey) : undefined}
          >
            <Icon className="size-4 shrink-0" />
            {!collapsed && <span className="truncate">{t(labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t border-sidebar-border p-2">
        <ThemeToggle
          showLabel={!collapsed}
          className={cn(collapsed && "w-full justify-center px-0")}
        />
        <LanguageToggle
          showLabel={!collapsed}
          className={cn(collapsed && "w-full justify-center px-0")}
        />
        <Button
          variant="ghost"
          className={cn("w-full justify-start gap-3", collapsed && "justify-center px-0")}
          onClick={handleLogout}
        >
          <LogOut className="size-4 shrink-0" />
          {!collapsed && t("sidebar.logout")}
        </Button>
        {version && !collapsed && (
          <div
            className="truncate px-2.5 pt-1 text-xs text-sidebar-foreground/50"
            title={`${t("sidebar.versionTitle")} ${version}`}
          >
            v{version}
          </div>
        )}
      </div>
    </aside>
  )
}
