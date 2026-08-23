import { Outlet } from "react-router-dom"

import { AppSidebar } from "@/components/layout/app-sidebar"

export function AppLayout() {
  return (
    <div className="flex h-svh w-full overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
