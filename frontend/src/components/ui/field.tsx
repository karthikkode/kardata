// Accessible field composition over Base UI Field: label, optional
// description, and error with correct input associations owned by the
// primitive (Base UI wires htmlFor/describedBy/invalid automatically).
import * as React from 'react'
import { Field } from '@base-ui/react/field'
import { cn } from '@/lib/utils'

function FieldRoot({ className, ...props }: React.ComponentProps<typeof Field.Root>) {
  return (
    <Field.Root data-slot="field" className={cn('flex flex-col gap-1.5', className)} {...props} />
  )
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Field.Label>) {
  return (
    <Field.Label
      data-slot="field-label"
      className={cn('text-ui font-medium text-foreground select-none', className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<typeof Field.Description>) {
  return (
    <Field.Description
      data-slot="field-description"
      className={cn('text-xs text-foreground-subtle', className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: React.ComponentProps<typeof Field.Error>) {
  return (
    <Field.Error
      data-slot="field-error"
      className={cn('text-xs text-danger', className)}
      {...props}
    />
  )
}

export { FieldRoot, FieldLabel, FieldDescription, FieldError }
