import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  const reduceMotion = useReducedMotion()

  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative flex w-fit max-w-full items-center overflow-x-auto border-b border-outline-variant",
        className
      )}
      {...props}
    >
      {props.children}
      <TabsPrimitive.Indicator
        data-slot="tabs-indicator"
        render={
          <motion.span
            layout
            // M3 Expressive "default spatial" spring — see switch.tsx.
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 380, damping: 31 }
            }
          />
        }
        className="absolute -bottom-px h-0.75 rounded-t-xs bg-primary"
      />
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "state-layer inline-flex h-12 flex-1 items-center justify-center gap-1.5 px-4 text-title-small whitespace-nowrap text-on-surface-variant transition-colors outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-[0.38] data-active:text-primary",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex flex-col gap-4 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
