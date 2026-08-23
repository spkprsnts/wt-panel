import * as React from "react"
import { Pencil } from "lucide-react"

import { api, type Profile } from "@/lib/api"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ProfileForm, type ProfileFormInitialValues, type ProfileSubmitPayload } from "@/components/profile-form"

export function EditProfileDialog({
  profile,
  onUpdated,
}: {
  profile: Profile
  onUpdated: () => void
}) {
  const [open, setOpen] = React.useState(false)
  // Bumped only when the dialog actually opens — used in ProfileForm's key
  // below so it remounts with fresh state each time (no stale in-progress
  // edits left over from a previous open-then-cancel), without ever
  // unmounting ProfileForm ourselves on close. Unmounting on close (an
  // earlier version did `{open && <ProfileForm .../>}`) yanked the content
  // out of the DOM the instant `open` flipped false, while Radix's own
  // Dialog close animation (fading/scaling DialogContent, including the
  // title) kept playing on what was left — the content disappearing
  // abruptly while the title faded out smoothly after. Radix needs the
  // content to stay mounted for the whole exit transition.
  const [openCount, setOpenCount] = React.useState(0)

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next) setOpenCount((c) => c + 1)
  }

  const initialValues: ProfileFormInitialValues = {
    name: profile.Name,
    coreType: profile.CoreType,
    coreConfigRaw: profile.CoreConfig,
    xrayEnabled: profile.XrayEnabled,
    xrayInboundId: profile.XrayInboundID,
    xrayManualUri: profile.XrayManualURI,
    xrayManualWireGuard: profile.XrayManualWireGuard,
    xrayDualRoute: profile.XrayDualRoute,
    xrayDirectAddress: profile.XrayDirectAddress,
    xrayHcInterval: profile.XrayHcInterval,
    xrayMux: profile.XrayMux,
  }

  async function handleSubmit(payload: ProfileSubmitPayload) {
    await api.updateProfile(profile.ID, payload)
    setOpen(false)
    onUpdated()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" title="Редактировать профиль">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Редактирование профиля</DialogTitle>
        </DialogHeader>
        <ProfileForm
          key={`${profile.ID}-${openCount}`}
          mode="edit"
          initialValues={initialValues}
          submitLabel="Сохранить"
          submittingLabel="Сохраняем..."
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
