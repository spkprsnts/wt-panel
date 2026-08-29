// Merges every dictionary/*.ts fragment into two flat lookup tables.
// Deliberately static imports + explicit spreads, not glob-based
// auto-discovery: spreading each fragment's `ru` object into one literal
// lets TypeScript infer the exact key union (TranslationKey below), and
// `en`'s explicit `Record<TranslationKey, string>` annotation then makes
// TypeScript refuse to compile if a fragment added a `ru` key without a
// matching `en` one (or vice versa).
//
// New fragments are wired in here by hand — this is the one file in the
// i18n system where concurrent edits could collide.
import { common } from "./dictionaries/common"
import { sidebar } from "./dictionaries/sidebar"
import { login } from "./dictionaries/login"
import { entityDialogs } from "./dictionaries/entityDialogs"
import { profileLogs } from "./dictionaries/profileLogs"
import { qrDialog } from "./dictionaries/qrDialog"
import { clientForm } from "./dictionaries/clientForm"
import { settings } from "./dictionaries/settings"
import { xray } from "./dictionaries/xray"
import { profileForm } from "./dictionaries/profileForm"
import { kernels } from "./dictionaries/kernels"
import { rooms } from "./dictionaries/rooms"
import { clientsPage } from "./dictionaries/clientsPage"
import { dashboard } from "./dictionaries/dashboard"
import { themeToggle } from "./dictionaries/themeToggle"

export const ru = {
  ...common.ru,
  ...sidebar.ru,
  ...login.ru,
  ...entityDialogs.ru,
  ...profileLogs.ru,
  ...qrDialog.ru,
  ...clientForm.ru,
  ...settings.ru,
  ...xray.ru,
  ...profileForm.ru,
  ...kernels.ru,
  ...rooms.ru,
  ...clientsPage.ru,
  ...dashboard.ru,
  ...themeToggle.ru,
}

export type TranslationKey = keyof typeof ru

export const en: Record<TranslationKey, string> = {
  ...common.en,
  ...sidebar.en,
  ...login.en,
  ...entityDialogs.en,
  ...profileLogs.en,
  ...qrDialog.en,
  ...clientForm.en,
  ...settings.en,
  ...xray.en,
  ...profileForm.en,
  ...kernels.en,
  ...rooms.en,
  ...clientsPage.en,
  ...dashboard.en,
  ...themeToggle.en,
}
