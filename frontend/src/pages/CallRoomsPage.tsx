import * as React from "react"
import { Pencil, Trash2 } from "lucide-react"

import { useT } from "@/lib/i18n"
import type { TranslationKey } from "@/i18n"
import { api, type CallRoom, type RoomProvider } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
      <DialogTrigger asChild>
        {room ? (
          <Button size="sm" variant="ghost" title={t("rooms.editTrigger")}>
            <Pencil className="size-4" />
          </Button>
        ) : (
          <Button>{t("rooms.addTrigger")}</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? t("rooms.editTitle") : t("rooms.createTitle")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t("rooms.providerLabel")}</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as RoomProvider)}>
              <SelectTrigger className="w-full">
                <SelectValue />
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-id">{t("rooms.roomIdLabel")}</Label>
            <Input id="room-id" value={roomId} onChange={(e) => setRoomId(e.target.value)} required />
            <p className="text-xs text-muted-foreground">{t(ROOM_ID_HINTS[provider])}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-label">{t("rooms.labelField")}</Label>
            <Input
              id="room-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("rooms.labelPlaceholder")}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-notes">{t("rooms.notesLabel")}</Label>
            <Input id="room-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{t("sidebar.nav.rooms")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("rooms.pageDescription")}
          </p>
        </div>
        <RoomDialog onSaved={load} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
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
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rooms.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {t("rooms.empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
