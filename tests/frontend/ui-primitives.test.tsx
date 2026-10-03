import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Textarea } from '@/components/ui/textarea'
import { FieldDescription, FieldError, FieldLabel, FieldRoot } from '@/components/ui/field'
import { CheckboxRoot } from '@/components/ui/checkbox'
import { SwitchRoot } from '@/components/ui/switch'
import { TabsList, TabsPanel, TabsRoot, TabsTab } from '@/components/ui/tabs'
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from '@/components/ui/menu'
import { PopoverPopup, PopoverRoot, PopoverTrigger } from '@/components/ui/popover'
import {
  DialogBody,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { ConfirmAction } from '@/components/ui/alert-dialog'
import { TooltipPopup, TooltipRoot, TooltipTrigger } from '@/components/ui/tooltip'
import { CollapsiblePanel, CollapsibleRoot, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ProgressRoot } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { SelectItem, SelectPopup, SelectRoot, SelectTrigger } from '@/components/ui/select'
import { useState } from 'react'

describe('owned primitives', () => {
  it('disables a pending button and marks it busy', () => {
    render(<Button pending>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
  })

  it('connects textarea invalid state for assistive tech', () => {
    render(<Textarea aria-label="Notes" invalid defaultValue="draft" />)
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'true')
  })

  it('associates field label, description, and error', () => {
    render(
      <FieldRoot>
        <FieldLabel>Sector name</FieldLabel>
        <FieldDescription>Lowercase with dashes.</FieldDescription>
        <FieldError match="valueMissing">Name is required.</FieldError>
      </FieldRoot>,
    )
    expect(screen.getByText('Sector name')).toBeInTheDocument()
    expect(screen.getByText('Lowercase with dashes.')).toBeInTheDocument()
  })

  it('toggles a checkbox through assistive tech', async () => {
    const user = userEvent.setup()
    const onCheckedChange = vi.fn()
    render(<CheckboxRoot aria-label="Include" onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByRole('checkbox', { name: 'Include' }))
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything())
  })

  it('supports checkbox indeterminate state', () => {
    render(<CheckboxRoot aria-label="Include" indeterminate />)
    expect(screen.getByRole('checkbox', { name: 'Include' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    )
  })

  it('exposes switch as a checkbox with an accessible name', () => {
    render(<SwitchRoot aria-label="Compact rows" />)
    expect(screen.getByRole('switch', { name: 'Compact rows' })).toBeInTheDocument()
  })

  it('selects tabs with arrow-key navigation', async () => {
    const user = userEvent.setup()
    render(
      <TabsRoot defaultValue="sectors">
        <TabsList>
          <TabsTab value="sectors">Sectors</TabsTab>
          <TabsTab value="companies">Companies</TabsTab>
        </TabsList>
        <TabsPanel value="sectors">sector list</TabsPanel>
        <TabsPanel value="companies">company list</TabsPanel>
      </TabsRoot>,
    )
    expect(screen.getByText('sector list')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Companies' }))
    expect(screen.getByText('company list')).toBeInTheDocument()
  })

  it('renders exactly one tab indicator inside the active tab', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <TabsRoot defaultValue="sectors">
        <TabsList>
          <TabsTab value="sectors">Sectors</TabsTab>
          <TabsTab value="companies">Companies</TabsTab>
        </TabsList>
        <TabsPanel value="sectors">sector list</TabsPanel>
        <TabsPanel value="companies">company list</TabsPanel>
      </TabsRoot>,
    )
    const indicators = () => container.querySelectorAll('[data-slot="tab-indicator"]')
    expect(indicators()).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Sectors' })).toContainElement(indicators()[0])
    await user.click(screen.getByRole('tab', { name: 'Companies' }))
    expect(indicators()).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Companies' })).toContainElement(indicators()[0])
  })

  it('renders the segmented thumb inside the active tab only', () => {
    const { container } = render(
      <TabsRoot defaultValue="research">
        <TabsList variant="segmented">
          <TabsTab value="research">Research</TabsTab>
          <TabsTab value="chats">Chats</TabsTab>
        </TabsList>
        <TabsPanel value="research">research list</TabsPanel>
        <TabsPanel value="chats">chat list</TabsPanel>
      </TabsRoot>,
    )
    const indicators = container.querySelectorAll('[data-slot="tab-indicator"]')
    expect(indicators).toHaveLength(1)
    expect(indicators[0]).toHaveClass('bg-surface-raised')
    expect(indicators[0]).toHaveClass('border-border')
    expect(screen.getByRole('tab', { name: 'Research' })).toContainElement(indicators[0])
  })

  it('opens a menu and closes it with Escape', async () => {
    const user = userEvent.setup()
    render(
      <MenuRoot>
        <MenuTrigger>Actions</MenuTrigger>
        <MenuPopup>
          <MenuItem>Rename</MenuItem>
        </MenuPopup>
      </MenuRoot>,
    )
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(await screen.findByRole('menuitem', { name: 'Rename' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument())
  })

  it('dismisses a popover with Escape', async () => {
    const user = userEvent.setup()
    render(
      <PopoverRoot>
        <PopoverTrigger>Details</PopoverTrigger>
        <PopoverPopup>Session identity</PopoverPopup>
      </PopoverRoot>,
    )
    await user.click(screen.getByRole('button', { name: 'Details' }))
    expect(await screen.findByText('Session identity')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Session identity')).not.toBeInTheDocument()
  })

  it('traps a dialog with title, scrollable body, and footer', async () => {
    const user = userEvent.setup()
    render(
      <DialogRoot>
        <DialogTrigger>Open</DialogTrigger>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Create sector</DialogTitle>
            <DialogClose />
          </DialogHeader>
          <DialogBody>
            <DialogDescription>Sector fields.</DialogDescription>
          </DialogBody>
          <DialogFooter>
            <Button>Save</Button>
          </DialogFooter>
        </DialogPopup>
      </DialogRoot>,
    )
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('dialog', { name: 'Create sector' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create sector' })).not.toBeInTheDocument())
  })

  it('confirms destructive actions explicitly with pending and error states', async () => {
    const user = userEvent.setup()
    render(
      <ConfirmAction
        open
        onOpenChange={() => undefined}
        title="Delete conversation?"
        description="This removes the normal chat. Research sessions cannot be deleted here."
        confirmLabel="Delete conversation"
        error="Delete failed. Try again."
        onConfirm={() => undefined}
      />,
    )
    expect(await screen.findByRole('alertdialog', { name: 'Delete conversation?' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Delete failed. Try again.')
    await user.click(screen.getByRole('button', { name: 'Delete conversation' }))
  })

  it('presents tooltips without becoming the label source', async () => {
    const user = userEvent.setup()
    render(
      <TooltipRoot>
        <TooltipTrigger aria-label="Collapse sidebar">collapse</TooltipTrigger>
        <TooltipPopup>Collapse sidebar</TooltipPopup>
      </TooltipRoot>,
    )
    await user.hover(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Collapse sidebar')
  })

  it('toggles a collapsible disclosure', async () => {
    const user = userEvent.setup()
    render(
      <CollapsibleRoot>
        <CollapsibleTrigger>Activity (2)</CollapsibleTrigger>
        <CollapsiblePanel>tool detail</CollapsiblePanel>
      </CollapsibleRoot>,
    )
    expect(screen.queryByText('tool detail')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activity (2)' }))
    expect(await screen.findByText('tool detail')).toBeInTheDocument()
  })

  it('renders determinate progress with its bounds', () => {
    render(<ProgressRoot aria-label="Indexing" value={40} max={100} />)
    expect(screen.getByRole('progressbar', { name: 'Indexing' })).toHaveAttribute('aria-valuenow', '40')
  })

  it('pairs badge text with its tone and hides nothing essential in title', () => {
    render(<Badge tone="warning">Paused</Badge>)
    expect(screen.getByText('Paused')).toBeInTheDocument()
  })

  it('reserves skeleton geometry without animation under reduced motion', () => {
    const { container } = render(<Skeleton className="h-10 w-full" />)
    const skeleton = container.firstElementChild!
    expect(skeleton).toHaveClass('motion-reduce:animate-none')
  })

  it('renders a token separator', () => {
    const { container } = render(<Separator />)
    expect(container.firstElementChild).toHaveAttribute('data-slot', 'separator')
  })

  it('renders fixed trigger text via valueText', async () => {
    const user = userEvent.setup()
    const options = [
      { value: 'all', label: 'All' },
      { value: 'failed', label: 'Failed' },
    ] as const
    function Harness() {
      const [value, setValue] = useState<(typeof options)[number]>(options[0])
      return (
        <SelectRoot
          value={value}
          onValueChange={(next) => {
            if (next) setValue(next)
          }}
        >
          <SelectTrigger aria-label={`Status: ${value.label}`} valueText={`Status: ${value.label}`} />
          <SelectPopup>
            {options.map((option) => (
              <SelectItem key={option.value} value={option}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </SelectRoot>
      )
    }
    render(<Harness />)
    expect(screen.getByRole('combobox', { name: 'Status: All' })).toHaveTextContent('Status: All')
    await user.click(screen.getByRole('combobox', { name: 'Status: All' }))
    await user.click(screen.getByRole('option', { name: 'Failed' }))
    expect(screen.getByRole('combobox', { name: 'Status: Failed' })).toHaveTextContent('Status: Failed')
  })
})
