// entityDialogs.ts covers the small create/edit dialog *wrappers* around
// ClientForm/ProfileForm (create-client-dialog.tsx, edit-client-dialog.tsx,
// add-profile-dialog.tsx, edit-profile-dialog.tsx) — just their own
// trigger/title/tooltip text, not the form fields themselves (those are
// client-form.tsx's/profile-form.tsx's own dictionaries).
export const entityDialogs = {
  ru: {
    "clientDialogs.editTooltip": "Редактировать клиента",
    "clientDialogs.editTitle": "Редактирование клиента",
    "clientDialogs.createTrigger": "Добавить клиента",
    "clientDialogs.createTitle": "Новый клиент",
    "profileDialogs.editTooltip": "Редактировать профиль",
    "profileDialogs.editTitle": "Редактирование профиля",
    "profileDialogs.createTrigger": "Профиль",
    "profileDialogs.createTitle": "Новый профиль",
  },
  en: {
    "clientDialogs.editTooltip": "Edit client",
    "clientDialogs.editTitle": "Edit client",
    "clientDialogs.createTrigger": "Add client",
    "clientDialogs.createTitle": "New client",
    "profileDialogs.editTooltip": "Edit profile",
    "profileDialogs.editTitle": "Edit profile",
    "profileDialogs.createTrigger": "Profile",
    "profileDialogs.createTitle": "New profile",
  },
}
