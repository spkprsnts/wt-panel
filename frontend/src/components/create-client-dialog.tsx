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
import { ClientForm, emptyClientFormValues, type ClientSubmitPayload } from "@/components/client-form"

export function CreateClientDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = React.useState(false)
  const [formKey, setFormKey] = React.useState(0)

  async function handleSubmit(payload: ClientSubmitPayload) {
    await api.createClient(payload)
    setOpen(false)
    setFormKey((k) => k + 1)
    onCreated()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Добавить клиента</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новый клиент</DialogTitle>
        </DialogHeader>
        <ClientForm
          key={formKey}
          initialValues={emptyClientFormValues}
          submitLabel="Создать"
          submittingLabel="Создаём..."
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
