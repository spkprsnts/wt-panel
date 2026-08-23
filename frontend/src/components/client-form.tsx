import * as React from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { DialogFooter } from "@/components/ui/dialog"

export interface ClientFormInitialValues {
  name: string
  description: string
  trafficLimitGb: string
  updateIntervalMinutes: string
}

export interface ClientSubmitPayload {
  name: string
  description: string
  trafficLimitByte: number
  updateIntervalMinutes: number
}

export const emptyClientFormValues: ClientFormInitialValues = {
  name: "",
  description: "",
  trafficLimitGb: "0",
  updateIntervalMinutes: "60",
}

// ClientForm is the shared body for both CreateClientDialog and
// EditClientDialog — description/updateIntervalMinutes are subscription
// metadata (docs/subscriptions.md §5.4 "description"/"updateIntervalMinutes")
// that only ever affect what a WireTurn client is told, never provisioning.
export function ClientForm({
  initialValues,
  submitLabel,
  submittingLabel,
  onSubmit,
}: {
  initialValues: ClientFormInitialValues
  submitLabel: string
  submittingLabel: string
  onSubmit: (payload: ClientSubmitPayload) => Promise<void>
}) {
  const [name, setName] = React.useState(initialValues.name)
  const [description, setDescription] = React.useState(initialValues.description)
  const [trafficLimitGb, setTrafficLimitGb] = React.useState(initialValues.trafficLimitGb)
  const [updateIntervalMinutes, setUpdateIntervalMinutes] = React.useState(
    initialValues.updateIntervalMinutes
  )
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await onSubmit({
        name,
        description,
        trafficLimitByte: (Number(trafficLimitGb) || 0) * 1024 * 1024 * 1024,
        updateIntervalMinutes: Number(updateIntervalMinutes) || 60,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить клиента")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="client-name">Имя</Label>
        <Input
          id="client-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="client-description">Описание</Label>
        <Textarea
          id="client-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Необязательно — показывается клиенту в приложении"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="client-traffic">Лимит трафика, ГБ (0 = без лимита)</Label>
          <Input
            id="client-traffic"
            type="number"
            min={0}
            value={trafficLimitGb}
            onChange={(e) => setTrafficLimitGb(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="client-refresh">Автообновление подписки, мин</Label>
          <Input
            id="client-refresh"
            type="number"
            min={1}
            value={updateIntervalMinutes}
            onChange={(e) => setUpdateIntervalMinutes(e.target.value)}
          />
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          {loading ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
