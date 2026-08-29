import * as React from "react"

// Disclosure is a plain native <details>/<summary> wrapper — was duplicated
// near-identically between profile-form.tsx's AdvancedFields (closed by
// default) and XrayPage.tsx's AdvancedSection (open by default) before this
// got pulled out; defaultOpen replaces that hardcoded difference.
function Disclosure({
  title,
  defaultOpen,
  children,
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  return (
    <details className="rounded-md border p-3 text-sm" open={defaultOpen}>
      <summary className="cursor-pointer font-medium text-on-surface-variant">{title}</summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  )
}

export { Disclosure }
