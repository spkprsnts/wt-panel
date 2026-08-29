import * as React from "react"
import { NavLink, useNavigate } from "react-router-dom"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { api, clearToken } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/i18n"
import { Icon } from "@/components/icon"
import { XrayIcon } from "@/components/xray-icon"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import type { TranslationKey } from "@/i18n"

// "xray-brand" is a sentinel, not a Material Symbols glyph name — Xray-core
// has its own four-blade pinwheel mark (see xray-icon.tsx), not a generic
// shield glyph, matching what WireTurn itself points at this feature with.
const NAV_ITEMS: { to: string; labelKey: TranslationKey; icon: string }[] = [
  { to: "/dashboard", labelKey: "sidebar.nav.dashboard", icon: "dashboard" },
  { to: "/clients", labelKey: "sidebar.nav.clients", icon: "group" },
  { to: "/xray", labelKey: "sidebar.nav.xray", icon: "xray-brand" },
  { to: "/rooms", labelKey: "sidebar.nav.rooms", icon: "videocam" },
  { to: "/kernels", labelKey: "sidebar.nav.kernels", icon: "deployed_code" },
  { to: "/settings", labelKey: "sidebar.nav.settings", icon: "settings" },
]

const COLLAPSE_KEY = "wtpanel_sidebar_collapsed"

// SidebarBody is the nav/footer content shared by the permanent desktop
// aside and the mobile off-canvas drawer (see AppSidebar below) — kept as
// one component so the two never drift out of sync with each other.
// onNavigate fires when a nav link is clicked, used only by the mobile
// drawer to close itself; the desktop aside has nothing to close.
function SidebarBody({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean
  onNavigate?: () => void
}) {
  const t = useT()
  return (
    <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
      {NAV_ITEMS.map(({ to, labelKey, icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "state-layer flex items-center gap-3 rounded-full py-2.5 text-label-large transition-colors",
              collapsed ? "justify-center px-0" : "px-3",
              isActive
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface-variant"
            )
          }
          title={collapsed ? t(labelKey) : undefined}
        >
          {icon === "xray-brand" ? (
            <XrayIcon size={20} className="shrink-0" />
          ) : (
            <Icon name={icon} size={20} className="shrink-0" />
          )}
          {!collapsed && <span className="truncate">{t(labelKey)}</span>}
        </NavLink>
      ))}
    </nav>
  )
}

function SidebarFooter({ collapsed, version }: { collapsed: boolean; version: string | null }) {
  const t = useT()
  const navigate = useNavigate()

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  return (
    <div className="flex flex-col gap-1 p-2">
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
        <Icon name="logout" size={20} className="shrink-0" />
        {!collapsed && t("sidebar.logout")}
      </Button>
      {version && !collapsed && (
        <div
          className="truncate px-3 pt-1 text-body-small text-on-surface-variant"
          title={`${t("sidebar.versionTitle")} ${version}`}
        >
          v{version}
        </div>
      )}
    </div>
  )
}

// Renders two independent things: a permanent desktop `<aside>` (collapse/
// expand toggle persisted in localStorage) and a mobile off-canvas drawer
// (Base UI Dialog styled as a left-sliding panel, only mounted below md via
// AppLayout's hamburger button). The drawer is always shown in its full,
// non-collapsed form and closes itself when a nav link is picked (see
// SidebarBody's onNavigate). The desktop collapse/expand and the mobile
// drawer are M3's "navigation rail" and "navigation drawer" — same
// adaptive pattern, re-skinned below.
export function AppSidebar({
  mobileOpen,
  onMobileOpenChange,
}: {
  mobileOpen: boolean
  onMobileOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1"
    } catch {
      return false
    }
  })
  // Fetched once here rather than inside SidebarFooter: that component is
  // rendered twice (desktop aside + mobile drawer), and a fetch inside it
  // would fire once for the desktop instance (mounted but display:none
  // below md) and again every time the mobile drawer opens.
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

  return (
    <>
      <aside
        className={cn(
          "hidden h-svh flex-col bg-surface text-on-surface transition-[width] duration-150 md:flex",
          collapsed ? "w-14" : "w-60"
        )}
      >
        <div className="flex h-14 items-center justify-between px-3">
          {!collapsed && <span className="truncate text-title-large">wt-panel</span>}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={toggleCollapsed}
            title={collapsed ? t("sidebar.expand") : t("sidebar.collapse")}
          >
            <Icon name={collapsed ? "left_panel_open" : "left_panel_close"} size={20} />
          </Button>
        </div>
        <SidebarBody collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} version={version} />
      </aside>

      <Dialog open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Popup
            className="fixed inset-y-0 left-0 z-50 flex h-svh w-72 flex-col rounded-r-lg bg-surface text-on-surface shadow-lg transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)] data-ending-style:-translate-x-full data-starting-style:-translate-x-full"
          >
            <DialogTitle className="sr-only">wt-panel</DialogTitle>
            <div className="flex h-14 items-center justify-between px-3">
              <span className="truncate text-title-large">wt-panel</span>
              <DialogClose
                render={<Button variant="ghost" size="icon" title={t("common.close")} />}
              >
                <Icon name="close" size={20} />
              </DialogClose>
            </div>
            <SidebarBody collapsed={false} onNavigate={() => onMobileOpenChange(false)} />
            <SidebarFooter collapsed={false} version={version} />
          </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
    </>
  )
}
