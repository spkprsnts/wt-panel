// index.ts merges every dictionary/*.ts fragment into two flat lookup
// tables. Deliberately static imports + explicit merging here, not a
// glob-based auto-discovery of dictionaries/*.ts: spreading each fragment's
// `ru` object into one literal object lets TypeScript infer the exact
// union of every key that exists (TranslationKey below) — a glob import
// has no way to statically type that union. `en`'s explicit
// `Record<TranslationKey, string>` annotation then means TypeScript
// itself refuses to compile if any fragment added a key to `ru` and
// forgot the matching `en` translation (or vice versa) — the single most
// useful safety net for a dictionary this large, spread across many files
// edited independently.
//
// New dictionary fragments are wired in here by hand, one import + one
// spread line, when they're added — dictionary files themselves are never
// touched by more than one change at a time, so this is the only file in
// the whole i18n system where concurrent edits could ever collide.
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
