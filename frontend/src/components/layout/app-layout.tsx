import * as React from "react"
import { Outlet } from "react-router-dom"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { AppSidebar } from "@/components/layout/app-sidebar"

// Below md there's no room for AppSidebar's permanent aside (even
// collapsed, it still eats fixed width alongside the page content) — this
// bar replaces it with a hamburger trigger that opens the same nav as an
// off-canvas drawer instead (see AppSidebar's own mobile Dialog).
export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  return (
    <div className="flex h-svh w-full flex-col overflow-hidden md:flex-row">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-outline-variant bg-surface px-3 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
          <Icon name="menu" size={20} />
        </Button>
        <span className="text-title-large text-on-surface">wt-panel</span>
      </div>
      <AppSidebar mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  )
}
