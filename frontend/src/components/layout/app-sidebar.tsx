import * as React from "react"
import { NavLink, useNavigate } from "react-router-dom"
import * as DialogPrimitive from "@radix-ui/react-dialog"
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
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog"
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
      {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
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
  )
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const t = useT()
  const navigate = useNavigate()
  const [version, setVersion] = React.useState<string | null>(null)

  React.useEffect(() => {
    api
      .getSettings()
      .then((s) => setVersion(s.version))
      .catch(() => {})
  }, [])

  function handleLogout() {
    clearToken()
    navigate("/login")
  }

  return (
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
  )
}

// AppSidebar renders two independent things: a permanent desktop `<aside>`
// (hidden below md, collapse/expand toggle persisted in localStorage — same
// as before) and a mobile off-canvas drawer (Radix Dialog styled as a
// left-sliding panel rather than a centered modal, only ever mounted below
// md via AppLayout's own `md:hidden` hamburger button). The drawer is
// always shown in its full, non-collapsed form — "collapse to icons" only
// makes sense as a way to reclaim desktop screen width, and closes itself
// the moment a nav link is picked (see SidebarBody's onNavigate) since
// there's no reason to leave it open over the page it just navigated to.
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
          "hidden h-svh flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:flex",
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
        <SidebarBody collapsed={collapsed} />
        <SidebarFooter collapsed={collapsed} />
      </aside>

      <Dialog open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <DialogPortal>
          <DialogOverlay />
          <DialogPrimitive.Content
            className="fixed inset-y-0 left-0 z-50 flex h-svh w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
          >
            <DialogTitle className="sr-only">wt-panel</DialogTitle>
            <div className="flex h-14 items-center border-b border-sidebar-border px-3">
              <span className="truncate font-semibold">wt-panel</span>
            </div>
            <SidebarBody collapsed={false} onNavigate={() => onMobileOpenChange(false)} />
            <SidebarFooter collapsed={false} />
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </>
  )
}
