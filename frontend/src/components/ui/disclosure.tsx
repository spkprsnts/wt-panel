import * as React from "react"

// A plain native <details>/<summary> wrapper; defaultOpen covers both the closed-by-default and open-by-default call sites.
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
