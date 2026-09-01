import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

// Sizing/spacing/disabled-state values read straight off AndroidX's BaselineButtonTokens/ButtonXSmallTokens/ButtonMediumTokens
// (compose/material3/material3 @ dd849e2) — secondary references disagreed with these in places, e.g. xs inline padding.
const buttonVariants = cva(
  "state-layer inline-flex min-w-[58px] items-center justify-center gap-2 whitespace-nowrap rounded-full text-label-large transition-colors disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:outline-2 aria-invalid:outline-error",
  {
    variants: {
      variant: {
        // Disabled containers swap to a flat onSurface wash (10%) plus onSurfaceVariant/38% content, not one blanket fade.
        default:
          "bg-primary text-on-primary disabled:bg-on-surface/10 disabled:text-on-surface-variant/38",
        elevated:
          "bg-surface-container-low text-primary shadow-elevation-1 hover:shadow-elevation-2 disabled:bg-on-surface/10 disabled:text-on-surface-variant/38 disabled:shadow-none",
        tonal:
          "bg-secondary-container text-on-secondary-container disabled:bg-on-surface/12 disabled:text-on-surface-variant/38",
        outline:
          "border border-outline-variant text-on-surface-variant disabled:border-outline-variant/10 disabled:text-on-surface-variant/38",
        ghost: "text-primary disabled:text-on-surface-variant/38",
        destructive:
          "bg-error text-on-error disabled:bg-on-surface/10 disabled:text-on-surface-variant/38",
        link: "text-primary underline-offset-4 hover:underline disabled:text-on-surface-variant/38",
        // shadcn-era alias kept so not-yet-migrated call sites still resolve.
        secondary:
          "bg-secondary-container text-on-secondary-container disabled:bg-on-surface/12 disabled:text-on-surface-variant/38",
      },
      size: {
        default: "h-10 px-6 has-[>svg]:px-4",
        sm: "h-8 px-4 has-[>svg]:px-3",
        lg: "h-14 px-6 text-title-medium has-[>svg]:px-4 [&_svg:not([class*='size-'])]:size-6",
        // min-w-0: minWidth protects short labels from looking cramped, but an icon-only button has no label and must stay square.
        icon: "size-10 min-w-0 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const reduceMotion = useReducedMotion()
  // Shape-morph on press: cornerSmall (8px) at 40/32px heights, cornerMedium (12px) at the 56px (lg) height.
  const pressedRadius = size === "lg" ? 12 : 8

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={
        <motion.button
          whileTap={
            reduceMotion ? undefined : { scale: 0.96, borderRadius: pressedRadius }
          }
          // M3 Expressive "fast spatial" spring (stiffness 800, dampingRatio 0.6); damping = dampingRatio * 2 * sqrt(stiffness).
          transition={{ type: "spring", stiffness: 800, damping: 34 }}
        />
      }
      {...props}
    />
  )
}

export { Button, buttonVariants }
