import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "state-layer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-label-large transition-colors disabled:pointer-events-none disabled:opacity-[0.38] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:outline-2 aria-invalid:outline-error",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary",
        elevated: "bg-surface-container-low text-primary shadow-sm",
        tonal: "bg-secondary-container text-on-secondary-container",
        outline: "border border-outline text-on-surface-variant",
        ghost: "text-primary",
        destructive: "bg-error text-on-error",
        link: "text-primary underline-offset-4 hover:underline",
        // shadcn-era alias kept so not-yet-migrated call sites still resolve.
        secondary: "bg-secondary-container text-on-secondary-container",
      },
      size: {
        default: "h-10 px-6 has-[>svg]:px-4",
        sm: "h-8 gap-1.5 px-4 has-[>svg]:px-3",
        lg: "h-14 px-8 text-title-medium has-[>svg]:px-6",
        icon: "size-10 rounded-full",
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

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      render={
        <motion.button
          whileTap={reduceMotion ? undefined : { scale: 0.96 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      }
      {...props}
    />
  )
}

export { Button, buttonVariants }
