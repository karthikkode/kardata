import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"
import { focusRingInput } from "@/lib/interaction"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        `h-10 w-full min-w-0 rounded-md border border-input bg-surface-sunken px-3 py-1 text-base transition-colors duration-120 ease-out-soft ${focusRingInput} file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-foreground-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm`,
        className
      )}
      {...props}
    />
  )
}

export { Input }
