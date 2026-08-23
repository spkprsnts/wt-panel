import * as React from "react"

import { api } from "@/lib/api"
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
  onCreated,
}: {
  clientId: number
  onCreated: () => void
}) {
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          + Профиль
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Новый профиль</DialogTitle>
        </DialogHeader>
        <ProfileForm
          key={formKey}
          mode="create"
          initialValues={emptyProfileFormValues}
          submitLabel="Создать"
          submittingLabel="Создаём..."
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
