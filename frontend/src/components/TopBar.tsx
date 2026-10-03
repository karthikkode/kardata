// TopBar (SH-03): 48px command bar. Left: a search-styled trigger that
// opens the command palette (icon-only below 768px). Right: Ask Karbot
// plus the theme menu (SH-04). Page search lives on the pages, never here.
import { Icons } from '@/lib/icons'
import type { ThemePreference } from '@/lib/theme'
import { IconButton } from './IconButton'
import { ThemeMenu } from './ThemeMenu'
import { Kbd } from './text'
import { Button } from './ui/button'

export function TopBar({
  chatOpen,
  onChatToggle,
  onOpenPalette,
  themePreference,
  onThemePreference,
}: {
  chatOpen: boolean
  onChatToggle: () => void
  onOpenPalette: () => void
  themePreference: ThemePreference
  onThemePreference: (next: ThemePreference) => void
}) {
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle bg-background px-4">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onOpenPalette}
        aria-keyshortcuts="Control+k Meta+k"
        className="hidden h-8 min-w-0 flex-1 justify-start px-3 font-normal text-muted-foreground md:flex lg:min-w-60 lg:max-w-sm"
      >
        <Icons.search className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-left">Search...</span>
        <Kbd className="ml-auto shrink-0">Ctrl K</Kbd>
      </Button>
      <IconButton label="Search" shortcut="Ctrl K" onClick={onOpenPalette} className="md:hidden">
        <Icons.search className="size-4" aria-hidden />
      </IconButton>
      <span className="ml-auto flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onChatToggle}
          aria-label="Ask Karbot"
          aria-expanded={chatOpen}
          className="hidden h-8 md:inline-flex"
        >
          <Icons.karbot className="size-4" aria-hidden />
          Ask Karbot
        </Button>
        <IconButton label="Ask Karbot" onClick={onChatToggle} aria-expanded={chatOpen} className="md:hidden">
          <Icons.karbot className="size-4" aria-hidden />
        </IconButton>
        <ThemeMenu preference={themePreference} onPreference={onThemePreference} />
      </span>
    </header>
  )
}
