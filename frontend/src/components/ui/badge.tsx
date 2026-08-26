import * as React from "react"
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-sm px-2 py-0.5 text-label-medium w-fit whitespace-nowrap shrink-0 gap-1 [&>svg]:size-3 overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-secondary-container text-on-secondary-container",
        success: "bg-success-container text-on-success-container",
        warning: "bg-warning-container text-on-warning-container",
        info: "bg-info-container text-on-info-container",
        destructive: "bg-error-container text-on-error-container",
        outline: "border border-outline text-on-surface-variant",
        // shadcn-era alias kept so not-yet-migrated call sites still resolve.
        secondary: "bg-secondary-container text-on-secondary-container",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    render,
    props: mergeProps<"span">(
      { "data-slot": "badge", className: cn(badgeVariants({ variant }), className) } as React.ComponentProps<"span">,
      props
    ),
  })
}

export { Badge, badgeVariants }
