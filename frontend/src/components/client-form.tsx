import * as React from "react"

import { useT } from "@/lib/i18n"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { SectionGroup, SectionItem, TextFieldRow } from "@/components/ui/section"

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

// Shared body for CreateClientDialog/EditClientDialog; description/updateIntervalMinutes are subscription metadata (docs/subscriptions.md §5.4) that only affect what a WireTurn client is told, never provisioning.
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
  const t = useT()
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
      setError(err instanceof Error ? err.message : t("clientForm.saveFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <SectionGroup>
        <SectionItem position="top">
          <TextFieldRow
            label={t("clientForm.name")}
            value={name}
            onChange={setName}
            required
            autoFocus
          />
        </SectionItem>
        <SectionItem position="middle">
          <TextFieldRow
            label={t("clientForm.description")}
            value={description}
            onChange={setDescription}
            multiline
            rows={3}
            placeholder={t("clientForm.descriptionPlaceholder")}
          />
        </SectionItem>
        <SectionItem position="middle">
          <TextFieldRow
            label={t("clientForm.trafficLimit")}
            type="number"
            min={0}
            value={trafficLimitGb}
            onChange={setTrafficLimitGb}
          />
        </SectionItem>
        <SectionItem position="bottom">
          <TextFieldRow
            label={t("clientForm.updateInterval")}
            type="number"
            min={1}
            value={updateIntervalMinutes}
            onChange={setUpdateIntervalMinutes}
          />
        </SectionItem>
      </SectionGroup>

      {error && <p className="text-sm text-error">{error}</p>}
      <DialogFooter>
        <Button type="submit" disabled={loading}>
          {loading ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
