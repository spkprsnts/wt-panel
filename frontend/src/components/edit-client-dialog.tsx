import * as React from "react"

import { api, type Client } from "@/lib/api"
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
import { ClientForm, type ClientFormInitialValues, type ClientSubmitPayload } from "@/components/client-form"

export function EditClientDialog({
  client,
  onUpdated,
}: {
  client: Client
  onUpdated: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  // See EditProfileDialog's openCount comment — same reasoning: remount on
  // open instead of unmounting on close, so Base UI's Dialog exit animation
  // has something to animate.
  const [openCount, setOpenCount] = React.useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setOpenCount((c) => c + 1)
  }

  const initialValues: ClientFormInitialValues = {
    name: client.Name,
    description: client.Description,
    trafficLimitGb: String(client.TrafficLimitByte / (1024 * 1024 * 1024)),
    updateIntervalMinutes: String(client.UpdateIntervalMinutes || 60),
  }

  async function handleSubmit(payload: ClientSubmitPayload) {
    // enabled/expiresAt aren't part of this form — echo the client's
    // current values back so the update doesn't clobber them (see
    // api.updateClient's doc comment).
    await api.updateClient(client.ID, {
      ...payload,
      enabled: client.Enabled,
      expiresAt: client.ExpiresAt ? Math.floor(new Date(client.ExpiresAt).getTime() / 1000) : null,
    })
    setOpen(false)
    onUpdated()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button size="sm" variant="ghost" title={t("clientDialogs.editTooltip")}>
            <Icon name="edit" size={18} />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("clientDialogs.editTitle")}</DialogTitle>
        </DialogHeader>
        <ClientForm
          key={`${client.ID}-${openCount}`}
          initialValues={initialValues}
          submitLabel={t("common.save")}
          submittingLabel={t("common.saving")}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
