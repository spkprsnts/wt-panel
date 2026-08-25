import * as React from "react"
import { Outlet } from "react-router-dom"
import { Menu } from "lucide-react"

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
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 md:hidden">
        <Button variant="ghost" size="icon" className="size-8" onClick={() => setMobileNavOpen(true)}>
          <Menu className="size-4" />
        </Button>
        <span className="font-semibold text-sidebar-foreground">wt-panel</span>
      </div>
      <AppSidebar mobileOpen={mobileNavOpen} onMobileOpenChange={setMobileNavOpen} />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
