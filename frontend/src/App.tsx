import { Navigate, Route, BrowserRouter, Routes } from "react-router-dom"

import { BASE_PATH, getToken } from "@/lib/api"
import { AppLayout } from "@/components/layout/app-layout"
import { LoginPage } from "@/pages/LoginPage"
import { DashboardPage } from "@/pages/DashboardPage"
import { ClientsPage } from "@/pages/ClientsPage"
import { XrayPage } from "@/pages/XrayPage"
import { CallRoomsPage } from "@/pages/CallRoomsPage"
import { KernelsPage } from "@/pages/KernelsPage"
import { SettingsPage } from "@/pages/SettingsPage"

function RequireAuth({ children }: { children: React.ReactNode }) {
  if (!getToken()) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter basename={BASE_PATH}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/xray" element={<XrayPage />} />
          <Route path="/rooms" element={<CallRoomsPage />} />
          <Route path="/kernels" element={<KernelsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
