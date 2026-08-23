import * as React from "react"

import { api, type Client } from "@/lib/api"
import { useDialogPrompt } from "@/components/dialog-prompt"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { CreateClientDialog } from "@/components/create-client-dialog"
import { EditClientDialog } from "@/components/edit-client-dialog"
import { AddProfileDialog } from "@/components/add-profile-dialog"
import { EditProfileDialog } from "@/components/edit-profile-dialog"
import { ProfileLogsDialog } from "@/components/profile-logs-dialog"
import { QrDialog } from "@/components/qr-dialog"
import { ChevronRight, Loader2, QrCode, RotateCw } from "lucide-react"

function formatBytes(n: number): string {
  if (n <= 0) return "0"
  const units = ["Б", "КБ", "МБ", "ГБ", "ТБ"]
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(1)} ${units[i]}`
}

export function ClientsPage() {
  const { confirm, alert } = useDialogPrompt()
  const [clients, setClients] = React.useState<Client[]>([])
  const [expanded, setExpanded] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [restartingId, setRestartingId] = React.useState<number | null>(null)

  const load = React.useCallback(() => {
    api
      .listClients()
      .then(setClients)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [])

  React.useEffect(() => {
    load()
    // Profile status (Running/PID) is a live snapshot from the server, not
    // pushed — poll so the indicators in the expanded profile list don't
    // silently go stale while the page just sits open.
    const interval = window.setInterval(load, 10000)
    return () => window.clearInterval(interval)
  }, [load])

  async function handleDeleteClient(id: number) {
    if (!(await confirm("Удалить клиента и все его профили?", { destructive: true, confirmLabel: "Удалить" })))
      return
    await api.deleteClient(id)
    load()
  }

  async function handleDeleteProfile(id: number) {
    if (!(await confirm("Удалить профиль?", { destructive: true, confirmLabel: "Удалить" }))) return
    await api.deleteProfile(id)
    load()
  }

  async function handleRestartProfile(id: number) {
    setRestartingId(id)
    try {
      await api.restartProfile(id)
      load()
    } catch (err) {
      await alert(err instanceof Error ? err.message : "Не удалось перезапустить профиль", { title: "Ошибка" })
    } finally {
      setRestartingId(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Клиенты</h1>
        <CreateClientDialog onCreated={load} />
      </div>

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Имя</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Трафик</TableHead>
              <TableHead>Профили</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clients.map((client) => (
              <React.Fragment key={client.ID}>
                <TableRow
                  className="cursor-pointer transition-colors hover:bg-muted/50"
                  title="Нажмите, чтобы показать профили"
                  onClick={() =>
                    setExpanded(expanded === client.ID ? null : client.ID)
                  }
                >
                  <TableCell>
                    <ChevronRight
                      className={`size-4 text-muted-foreground transition-transform ${
                        expanded === client.ID ? "rotate-90" : ""
                      }`}
                    />
                  </TableCell>
                  <TableCell>{client.Name}</TableCell>
                  <TableCell>
                    <Badge variant={client.Enabled ? "default" : "secondary"}>
                      {client.Enabled ? "активен" : "отключен"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatBytes(client.TrafficUsedByte)}
                    {client.TrafficLimitByte > 0 &&
                      ` / ${formatBytes(client.TrafficLimitByte)}`}
                  </TableCell>
                  <TableCell>{client.Profiles?.length ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <div
                      className="inline-flex gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <QrDialog
                        title={`Подписка — ${client.Name}`}
                        trigger={
                          <Button size="sm" variant="outline" title="QR-код подписки">
                            <QrCode className="size-4" />
                          </Button>
                        }
                        loadVariants={() =>
                          api
                            .getSubscriptionLinks(client.ID)
                            .then(({ url, wireturnLink, domainUrl, domainWireturnLink }) => [
                              {
                                key: "wireturn",
                                label: "WireTurn",
                                content: domainWireturnLink
                                  ? { ip: wireturnLink, domain: domainWireturnLink }
                                  : wireturnLink,
                              },
                              {
                                key: "text",
                                label: "Текстовый",
                                content: domainUrl
                                  ? { ip: `${url}?format=text`, domain: `${domainUrl}?format=text` }
                                  : `${url}?format=text`,
                              },
                            ])
                        }
                        onDownload={() => api.downloadClientExport(client.ID)}
                        downloadLabel="Скачать все профили (.json)"
                      />
                      <EditClientDialog client={client} onUpdated={load} />
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDeleteClient(client.ID)}
                      >
                        Удалить
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                {expanded === client.ID && (
                  <TableRow>
                    <TableCell colSpan={6} className="bg-muted/30">
                      <div className="flex flex-col gap-3 p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Профили</span>
                          <AddProfileDialog clientId={client.ID} onCreated={load} />
                        </div>
                        {(client.Profiles ?? []).length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            Профилей пока нет
                          </p>
                        )}
                        {(client.Profiles ?? []).map((profile) => (
                          <div
                            key={profile.ID}
                            className="flex items-center justify-between rounded-md border bg-background p-2 text-sm"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-block size-2 rounded-full ${
                                  profile.Running ? "bg-green-500" : "bg-muted-foreground/40"
                                }`}
                                title={profile.Running ? "работает" : "не работает"}
                              />
                              <Badge variant="outline">{profile.CoreType}</Badge>
                              <span>{profile.Name}</span>
                              {profile.XrayEnabled && (
                                <Badge variant="secondary">
                                  {profile.XrayInbound?.Protocol ?? "xray (URI)"}
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <QrDialog
                                title={`Профиль — ${profile.Name}`}
                                trigger={
                                  <Button size="sm" variant="ghost" title="QR-код профиля">
                                    <QrCode className="size-4" />
                                  </Button>
                                }
                                loadVariants={() =>
                                  api.getProfileLinks(profile.ID).then(({ kernelUri, wireturnLink }) => [
                                    { key: "wireturn", label: "WireTurn", content: wireturnLink },
                                    { key: "kernel", label: "URI ядра", content: kernelUri },
                                  ])
                                }
                                onDownload={() => api.downloadProfileExport(profile.ID)}
                                downloadLabel="Скачать профиль (.json)"
                              />
                              <EditProfileDialog profile={profile} onUpdated={load} />
                              <ProfileLogsDialog profileId={profile.ID} profileName={profile.Name} />
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Перезапустить процесс ядра для этого профиля"
                                disabled={restartingId === profile.ID}
                                onClick={() => handleRestartProfile(profile.ID)}
                              >
                                {restartingId === profile.ID ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <RotateCw className="size-4" />
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteProfile(profile.ID)}
                              >
                                Удалить
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))}
            {clients.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  Клиентов пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
