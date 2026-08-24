import * as React from "react"

import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ProfileForm, emptyProfileFormValues, type ProfileSubmitPayload } from "@/components/profile-form"

export function AddProfileDialog({
  clientId,
  existingProfileCount,
  onCreated,
}: {
  clientId: number
  // Only used to seed the new profile's default name ("Profile #N") — see
  // ClientsPage's own call site, which passes (client.Profiles ?? []).length.
  existingProfileCount: number
  onCreated: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  // Remounting the form on every open (via key) is simpler than a manual
  // resetForm() — a fresh key means fresh initial state, no leftover
  // values from a previous open lingering in ProfileForm's own state.
  const [formKey, setFormKey] = React.useState(0)

  async function handleSubmit(payload: ProfileSubmitPayload) {
    await api.createProfile(clientId, payload)
    setOpen(false)
    setFormKey((k) => k + 1)
    onCreated()
  }

  const initialValues = {
    ...emptyProfileFormValues,
    name: `${t("profileForm.defaultNamePrefix")} #${existingProfileCount + 1}`,
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("profileDialogs.createTrigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("profileDialogs.createTitle")}</DialogTitle>
        </DialogHeader>
        <ProfileForm
          key={formKey}
          mode="create"
          initialValues={initialValues}
          submitLabel={t("common.create")}
          submittingLabel={t("common.creating")}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
