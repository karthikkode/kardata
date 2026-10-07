import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cloneElement, isValidElement } from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap outline-none select-none transition-all duration-120 ease-out-soft active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary:
          "border border-border bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-surface-hover dark:bg-surface-raised",
        outline:
          "border border-border bg-transparent hover:border-border-strong hover:bg-surface-hover",
        ghost:
          "text-muted-foreground hover:bg-surface-hover hover:text-foreground aria-expanded:bg-surface-hover aria-expanded:text-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-95",
        link: "h-auto min-h-0 gap-1 px-0 text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-8 pointer-coarse:h-10 gap-1 rounded-md px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 pointer-coarse:h-10 gap-1.5 rounded-md px-3 text-ui in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-10",
        "icon-xs":
          "size-8 pointer-coarse:size-10 in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm":
          "size-8 pointer-coarse:size-10 in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
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
  variant = "default",
  size = "default",
  pending = false,
  disabled,
  nativeButton,
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { pending?: boolean }) {
  // Anchor renders bypass the primitive entirely: Base UI would force
  // role="button" onto the anchor (nativeButton={false}) or warn about
  // the missing native button (default). A link stays a link: clone with
  // button styling, drop button-only props. Function-form render cannot
  // be inspected and keeps the primitive path.
  if (isValidElement(render) && typeof render.type === 'string' && render.type !== 'button') {
    const { children: renderChildren, className: renderClassName, ...renderRest } = render.props as {
      children?: React.ReactNode
      className?: string
    } & Record<string, unknown>
    const { children, type: _type, ...rest } = props as { children?: React.ReactNode; type?: string } & Record<string, unknown>
    return cloneElement(
      render,
      {
        ...renderRest,
        ...rest,
        className: cn(buttonVariants({ variant, size, className }), renderClassName),
        'aria-busy': pending || undefined,
        'aria-disabled': disabled || pending || undefined,
      } as Record<string, unknown>,
      children ?? renderChildren,
    )
  }
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      nativeButton={nativeButton}
      render={render}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button }
