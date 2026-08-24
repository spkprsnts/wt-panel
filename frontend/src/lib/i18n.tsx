import * as React from "react"

import { ru, en, type TranslationKey } from "@/i18n"

// Language is a plain two-way choice, same shape as lib/theme.ts's own
// Theme type — no third "system" option, no locale negotiation, just
// "ru" or "en". Unlike theme (a DOM class toggle with no React state
// needed at all), changing language has to re-render every translated
// string on screen, so this one really does need a Context, not a plain
// module-level getter/setter.
export type Language = "ru" | "en"

const LANGUAGE_KEY = "wtpanel_language"

const DICTIONARIES: Record<Language, Record<TranslationKey, string>> = { ru, en }

function getStoredLanguage(): Language | null {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY)
    return v === "ru" || v === "en" ? v : null
  } catch {
    return null
  }
}

function storeLanguage(language: Language) {
  try {
    localStorage.setItem(LANGUAGE_KEY, language)
  } catch {
    // ignore — language still applies for this page view, just won't persist
  }
}

// Default is "ru", not the browser's own language: every existing
// operator of this panel is already using it in Russian today, and a
// silent switch to English on whatever locale their browser happens to
// report would be a regression for all of them. English is the opt-in.
const DEFAULT_LANGUAGE: Language = "ru"

interface LanguageContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: TranslationKey) => string
}

const LanguageContext = React.createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = React.useState<Language>(() => getStoredLanguage() ?? DEFAULT_LANGUAGE)

  const setLanguage = React.useCallback((next: Language) => {
    storeLanguage(next)
    setLanguageState(next)
  }, [])

  const t = React.useCallback((key: TranslationKey) => DICTIONARIES[language][key] ?? key, [language])

  const value = React.useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

// useT is the everyday hook — components importing just t() are the
// overwhelming majority of call sites; useLanguage below is only for the
// switcher itself.
export function useT() {
  return useLanguageContext().t
}

export function useLanguage(): [Language, (language: Language) => void] {
  const ctx = useLanguageContext()
  return [ctx.language, ctx.setLanguage]
}

function useLanguageContext(): LanguageContextValue {
  const ctx = React.useContext(LanguageContext)
  if (!ctx) {
    throw new Error("useT/useLanguage must be used within LanguageProvider")
  }
  return ctx
}
