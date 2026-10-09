// Command palette (F9): Ctrl/Cmd+K from anywhere. Navigate between
// sections, jump to a sector, or run a top-level action. Data enters via
// props (sectors + callbacks); the palette never fetches.
import * as React from 'react'
import { Command } from 'cmdk'
import { Icons } from '@/lib/icons'
import { focusRingInput } from '@/lib/interaction'
import { Caption, Kbd } from './text'
import { DialogPopup, DialogRoot, DialogTitle } from './ui/dialog'

export interface PaletteSector {
  id: string
  name: string
  topic: string
}

export type PaletteSection = 'Overview' | 'Researches' | 'Agents' | 'Models'

const NAV_ITEMS: Array<{ section: PaletteSection; icon: keyof typeof Icons }> = [
  { section: 'Overview', icon: 'overview' },
  { section: 'Researches', icon: 'researches' },
  { section: 'Agents', icon: 'agents' },
  { section: 'Models', icon: 'models' },
]

export function CommandPalette({
  open,
  onOpenChange,
  sectors,
  onNavigate,
  onSelectSector,
  onNewSector,
  onOpenKarbot,
  onToggleTheme,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sectors: PaletteSector[]
  onNavigate: (section: PaletteSection) => void
  onSelectSector: (sectorId: string) => void
  onNewSector: () => void
  onOpenKarbot: () => void
  onToggleTheme: () => void
}) {
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onOpenChange])

  function run(action: () => void) {
    return () => {
      onOpenChange(false)
      action()
    }
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-160">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command
          label="Command palette"
          loop
          className="flex min-h-0 flex-col overflow-hidden"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle px-4">
            <Icons.search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              placeholder="Search commands and sectors..."
              className={`h-full w-full bg-transparent text-sm placeholder:text-foreground-subtle ${focusRingInput}`}
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="scroll-slim max-h-[320px] min-h-0 flex-1 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-ui text-muted-foreground">
              No matching commands
            </Command.Empty>
            <Command.Group heading="Navigate">
              {NAV_ITEMS.map((item) => {
                const Icon = Icons[item.icon]
                return (
                  <Command.Item
                    key={item.section}
                    value={`Navigate to ${item.section}`}
                    onSelect={run(() => onNavigate(item.section))}
                    className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none aria-selected:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                  >
                    <Icon aria-hidden />
                    {item.section}
                  </Command.Item>
                )
              })}
            </Command.Group>
            <Command.Group heading="Sectors">
              {sectors.map((sector) => (
                <Command.Item
                  key={sector.id}
                  value={sector.name}
                  keywords={[sector.topic]}
                  onSelect={run(() => onSelectSector(sector.id))}
                  className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none aria-selected:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                >
                  <Icons.sector aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{sector.name}</span>
                </Command.Item>
              ))}
            </Command.Group>
            <Command.Group heading="Actions">
              <Command.Item
                value="New sector"
                onSelect={run(onNewSector)}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none aria-selected:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
              >
                <Icons.add aria-hidden />
                New sector
              </Command.Item>
              <Command.Item
                value="Open Karbot"
                onSelect={run(onOpenKarbot)}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none aria-selected:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
              >
                <Icons.karbot aria-hidden />
                Open Karbot
              </Command.Item>
              <Command.Item
                value="Toggle theme"
                onSelect={run(onToggleTheme)}
                className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-left text-ui outline-none select-none aria-selected:bg-surface-hover [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
              >
                <Icons.themeSystem aria-hidden />
                Toggle theme
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="flex shrink-0 items-center gap-3 border-t border-border-subtle px-4 py-2">
            <Caption as="span" className="inline-flex items-center gap-1">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> Navigate
            </Caption>
            <Caption as="span" className="inline-flex items-center gap-1">
              <Kbd>Enter</Kbd> Select
            </Caption>
          </div>
        </Command>
      </DialogPopup>
    </DialogRoot>
  )
}
