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
import { ClientForm, emptyClientFormValues, type ClientSubmitPayload } from "@/components/client-form"

export function CreateClientDialog({ onCreated }: { onCreated: () => void }) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  // Bumped on open (not just after a successful submit) so closing without
  // submitting and reopening doesn't resurrect the abandoned draft.
  const [formKey, setFormKey] = React.useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setFormKey((k) => k + 1)
  }

  async function handleSubmit(payload: ClientSubmitPayload) {
    await api.createClient(payload)
    setOpen(false)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button>{t("clientDialogs.createTrigger")}</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("clientDialogs.createTitle")}</DialogTitle>
        </DialogHeader>
        <ClientForm
          key={formKey}
          initialValues={emptyClientFormValues}
          submitLabel={t("common.create")}
          submittingLabel={t("common.creating")}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
