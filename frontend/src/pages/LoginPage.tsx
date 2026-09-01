import * as React from "react"
import { useNavigate } from "react-router-dom"

import { api, ApiError, setToken } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { OtpInput } from "@/components/ui/otp-input"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageToggle } from "@/components/language-toggle"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export function LoginPage() {
  const t = useT()
  const navigate = useNavigate()
  const [username, setUsername] = React.useState("admin")
  const [password, setPassword] = React.useState("")
  // Flips to "totp" on the backend's "totp_required" response; username/password stay in state and are resent with the code since the backend re-validates all three together.
  const [step, setStep] = React.useState<"password" | "totp">("password")
  const [code, setCode] = React.useState("")
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  // totpOverride lets OtpInput's onComplete submit its code directly without waiting a render for `code` state to catch up.
  async function handleSubmit(e?: React.FormEvent, totpOverride?: string) {
    e?.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const { token } = await api.login(username, password, step === "totp" ? (totpOverride ?? code) : undefined)
      setToken(token)
      navigate("/dashboard")
    } catch (err) {
      if (err instanceof ApiError && err.message === "totp_required") {
        setStep("totp")
        return
      }
      if (err instanceof ApiError && err.status === 429) {
        setError(t("login.tooManyAttempts"))
        return
      }
      setError(step === "totp" ? t("login.totpError") : t("login.error"))
    } finally {
      setLoading(false)
    }
  }

  function handleBack() {
    setStep("password")
    setCode("")
    setError(null)
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center bg-surface-variant/30 p-4">
      <div className="absolute top-4 right-4 flex items-center gap-1">
        <LanguageToggle />
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>wt-panel</CardTitle>
          <CardDescription>{step === "totp" ? t("login.totpSubtitle") : t("login.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {step === "password" ? (
              <>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="username">{t("login.username")}</Label>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="password">{t("login.password")}</Label>
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Label id="totp-code-label">{t("login.totpCode")}</Label>
                <OtpInput
                  id="totp-code"
                  aria-labelledby="totp-code-label"
                  value={code}
                  onChange={setCode}
                  onComplete={(v) => handleSubmit(undefined, v)}
                  autoFocus
                />
              </div>
            )}
            {error && <p className="text-sm text-error">{error}</p>}
            <Button type="submit" disabled={loading}>
              {loading ? t("login.submitting") : t("login.submit")}
            </Button>
            {step === "totp" && (
              <button type="button" onClick={handleBack} className="text-sm text-on-surface-variant hover:underline">
                {t("login.back")}
              </button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
