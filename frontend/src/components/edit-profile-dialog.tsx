import * as React from "react"

import { api, type Profile } from "@/lib/api"
import { useT } from "@/lib/i18n"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ProfileForm, type ProfileFormInitialValues, type ProfileSubmitPayload } from "@/components/profile-form"

// open/onOpenChange are controlled by the caller (ClientsPage's dropdown menu, not a trigger of its own) — a Dialog can't safely nest inside a DropdownMenuItem.
export function EditProfileDialog({
  profile,
  open,
  onOpenChange,
  onUpdated,
}: {
  profile: Profile
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdated: () => void
}) {
  const t = useT()
  // Bumped only on open, used in ProfileForm's key so it remounts with fresh state without ever unmounting on close — unmounting via `{open && <ProfileForm/>}` yanked content out of the DOM before Base UI's close animation, which needs it to stay mounted through the exit transition, could finish.
  const [openCount, setOpenCount] = React.useState(0)

  function handleOpenChange(next: boolean) {
    onOpenChange(next)
    if (next) setOpenCount((c) => c + 1)
  }

  const initialValues: ProfileFormInitialValues = {
    name: profile.Name,
    coreType: profile.CoreType,
    coreConfigRaw: profile.CoreConfig,
    enabled: profile.Enabled,
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
    onOpenChange(false)
    onUpdated()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden px-0 py-6 sm:max-w-xl">
        <DialogHeader className="shrink-0 px-6">
          <DialogTitle>{t("profileDialogs.editTitle")}</DialogTitle>
        </DialogHeader>
        <ProfileForm
          key={`${profile.ID}-${openCount}`}
          mode="edit"
          initialValues={initialValues}
          submitLabel={t("common.save")}
          submittingLabel={t("common.saving")}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
