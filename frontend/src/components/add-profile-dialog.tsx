import * as React from "react"

import { api } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { Icon } from "@/components/icon"
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
  // values from a previous open lingering in ProfileForm's own state. Bumped
  // on open (not just after a successful submit) so closing without
  // submitting and reopening doesn't resurrect the abandoned draft — mirrors
  // EditProfileDialog's openCount for the same reason.
  const [formKey, setFormKey] = React.useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setFormKey((k) => k + 1)
  }

  async function handleSubmit(payload: ProfileSubmitPayload) {
    await api.createProfile(clientId, payload)
    setOpen(false)
    onCreated()
  }

  const initialValues = {
    ...emptyProfileFormValues,
    name: `${t("profileForm.defaultNamePrefix")} #${existingProfileCount + 1}`,
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm">
            <Icon name="add" size={18} />
            {t("profileDialogs.createTrigger")}
          </Button>
        }
      />
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden px-0 py-6 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-6">
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
