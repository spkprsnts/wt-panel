import * as React from "react"

import { ru, en, type TranslationKey } from "@/i18n"

// Unlike theme (a DOM class toggle), changing language must re-render every translated string, so this needs a Context.
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

// Defaults to "ru", not the browser's language: existing operators already use this panel in Russian.
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

// The everyday hook — useLanguage below is only for the switcher itself.
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
