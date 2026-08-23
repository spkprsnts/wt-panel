import * as React from "react"

import { api, type CallRoom, type RoomProvider } from "@/lib/api"
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

export const PROVIDER_LABELS: Record<RoomProvider, string> = {
  vk: "VK Calls",
  wbstream: "WB Stream",
  telemost: "Телемост",
  jitsi: "Jitsi",
}

const ROOM_ID_HINTS: Record<RoomProvider, string> = {
  vk: "Часть ссылки после /call/join/, например: vk.com/call/join/ABC123xyz...",
  wbstream: "Часть ссылки после /room/ на stream.wb.ru, например: wb_stream_xxxxxxxx",
  telemost: "Цифры после /j/ в ссылке telemost.yandex.ru, например: 495XXXXXXXXX",
  jitsi: "Полный URL комнаты, например: https://meet.example.org/myroom",
}

function RoomDialog({
  room,
  onSaved,
}: {
  room?: CallRoom
  onSaved: () => void
}) {
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
      setError(err instanceof Error ? err.message : "Не удалось сохранить")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {room ? (
          <Button size="sm" variant="ghost">
            Изменить
          </Button>
        ) : (
          <Button>Добавить комнату</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? "Изменить комнату" : "Новая комната"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Провайдер</Label>
            <Select value={provider} onValueChange={(v) => setProvider(v as RoomProvider)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PROVIDER_LABELS) as RoomProvider[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-id">ID / URL комнаты</Label>
            <Input id="room-id" value={roomId} onChange={(e) => setRoomId(e.target.value)} required />
            <p className="text-xs text-muted-foreground">{ROOM_ID_HINTS[provider]}</p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-label">Название (для себя)</Label>
            <Input
              id="room-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="например, «Основной пул VK»"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-notes">Заметки</Label>
            <Input id="room-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={loading}>
              {loading ? "Сохраняем..." : "Сохранить"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CallRoomsPage() {
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
    if (!confirm("Удалить комнату из журнала?")) return
    await api.deleteCallRoom(id)
    load()
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Комнаты звонков</h1>
          <p className="text-sm text-muted-foreground">
            Журнал ID звонков/комнат для VK, WB Stream, Телемоста и Jitsi — при создании
            профиля Turnable/FreeTurn/olcRTC можно быстро выбрать комнату отсюда вместо
            повторного ввода
          </p>
        </div>
        <RoomDialog onSaved={load} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Провайдер</TableHead>
              <TableHead>ID / URL</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Валидность</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rooms.map((room) => (
              <TableRow key={room.ID}>
                <TableCell>
                  <Badge variant="outline">{PROVIDER_LABELS[room.Provider]}</Badge>
                </TableCell>
                <TableCell className="max-w-64 truncate font-mono text-xs">
                  {room.RoomID}
                </TableCell>
                <TableCell>{room.Label || "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary" title="Проверка валидности пока не реализована">
                    не проверялась
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <RoomDialog room={room} onSaved={load} />
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(room.ID)}>
                      Удалить
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {rooms.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  Комнат пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
