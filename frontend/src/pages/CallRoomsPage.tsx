import * as React from "react"

import { useT } from "@/lib/i18n"
import type { TranslationKey } from "@/i18n"
import { api, type CallRoom, type RoomProvider } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SectionGroup, SectionItem, TextFieldRow } from "@/components/ui/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export const PROVIDER_LABELS: Record<RoomProvider, TranslationKey> = {
  vk: "rooms.provider.vk",
  wbstream: "rooms.provider.wbstream",
  telemost: "rooms.provider.telemost",
  jitsi: "rooms.provider.jitsi",
}

const ROOM_ID_HINTS: Record<RoomProvider, TranslationKey> = {
  vk: "rooms.hint.vk",
  wbstream: "rooms.hint.wbstream",
  telemost: "rooms.hint.telemost",
  jitsi: "rooms.hint.jitsi",
}

function RoomDialog({
  room,
  onSaved,
}: {
  room?: CallRoom
  onSaved: () => void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const [provider, setProvider] = React.useState<RoomProvider>(room?.Provider ?? "vk")
  const [roomId, setRoomId] = React.useState(room?.RoomID ?? "")
  const [label, setLabel] = React.useState(room?.Label ?? "")
  const [notes, setNotes] = React.useState(room?.Notes ?? "")
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Re-seeds fields from `room` on open since this instance stays mounted for the whole row; keyed on room?.ID not the object, since `rooms` is rebuilt on every load() and depending on the object would reset in-progress edits whenever any other row saved.
  React.useEffect(() => {
    if (!open) return
    setProvider(room?.Provider ?? "vk")
    setRoomId(room?.RoomID ?? "")
    setLabel(room?.Label ?? "")
    setNotes(room?.Notes ?? "")
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, room?.ID])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (room) {
        await api.updateCallRoom(room.ID, { provider, roomId, label, notes })
      } else {
        await api.createCallRoom({ provider, roomId, label, notes })
      }
      setOpen(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t("rooms.saveFailed"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          room ? (
            <Button size="sm" variant="ghost" title={t("rooms.editTrigger")}>
              <Icon name="edit" size={18} />
            </Button>
          ) : (
            <Button>{t("rooms.addTrigger")}</Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? t("rooms.editTitle") : t("rooms.createTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <SectionGroup>
            <SectionItem position="top">
              <div className="flex w-full flex-col gap-1">
                <label className="text-title-medium text-on-surface">{t("rooms.providerLabel")}</label>
                <Select value={provider} onValueChange={(v) => setProvider(v as RoomProvider)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(v: RoomProvider | null) => (v ? t(PROVIDER_LABELS[v]) : null)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PROVIDER_LABELS) as RoomProvider[]).map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(PROVIDER_LABELS[p])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("rooms.roomIdLabel")}
                value={roomId}
                onChange={setRoomId}
                required
                supportingText={t(ROOM_ID_HINTS[provider])}
              />
            </SectionItem>
            <SectionItem position="middle">
              <TextFieldRow
                label={t("rooms.labelField")}
                value={label}
                onChange={setLabel}
                placeholder={t("rooms.labelPlaceholder")}
              />
            </SectionItem>
            <SectionItem position="bottom">
              <TextFieldRow label={t("rooms.notesLabel")} value={notes} onChange={setNotes} />
            </SectionItem>
          </SectionGroup>

          {error && <p className="text-sm text-error">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CallRoomsPage() {
  const t = useT()
  const { confirm } = useDialogPrompt()
  const [rooms, setRooms] = React.useState<CallRoom[]>([])
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    api
      .listCallRooms()
      .then(setRooms)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  async function handleDelete(id: number) {
    if (!(await confirm(t("rooms.deleteConfirm"), { destructive: true, confirmLabel: t("common.delete") }))) return
    await api.deleteCallRoom(id)
    load()
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-xl font-semibold">{t("sidebar.nav.rooms")}</h1>
          <p className="text-sm text-on-surface-variant">
            {t("rooms.pageDescription")}
          </p>
        </div>
        <div className="shrink-0">
          <RoomDialog onSaved={load} />
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-error">{error}</p>}

      <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("rooms.providerLabel")}</TableHead>
              <TableHead>ID / URL</TableHead>
              <TableHead>{t("rooms.colName")}</TableHead>
              <TableHead>{t("rooms.colValidity")}</TableHead>
              <TableHead className="text-right">{t("rooms.colActions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.ID}>
                <TableCell>
                  <Badge variant="outline">{t(PROVIDER_LABELS[room.Provider])}</Badge>
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs">
                  {room.RoomID}
                </TableCell>
                <TableCell>{room.Label || "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary" title={t("rooms.validityNotImplemented")}>
                    {t("rooms.notChecked")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <RoomDialog room={room} onSaved={load} />
                    <Button size="sm" variant="destructive" title={t("common.delete")} onClick={() => handleDelete(room.ID)}>
                      <Icon name="delete" size={18} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rooms.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-on-surface-variant">
                  {t("rooms.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
    </div>
  )
}
