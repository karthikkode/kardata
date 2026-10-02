import { MessageCircle, Moon, Sun, X } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function TopBar({
  query,
  onQuery,
  dark,
  onTheme,
  chatOpen,
  onChatToggle,
}: {
  query: string
  onQuery: (value: string) => void
  dark: boolean
  onTheme: () => void
  chatOpen: boolean
  onChatToggle: () => void
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
      <div className="relative max-w-sm flex-1">
        <Input
          aria-label="Search researches"
          placeholder="Search researches on Overview"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          className={query ? 'pr-8' : undefined}
        />
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onQuery('')}
            aria-label="Clear search"
            className="absolute top-1/2 right-1 -translate-y-1/2"
          >
            <X className="size-4" aria-hidden />
          </Button>
        ) : null}
      </div>
      <Button
        variant="outline"
        size="icon"
        onClick={onChatToggle}
        aria-label={chatOpen ? 'Close chat' : 'Open chat'}
        aria-expanded={chatOpen}
        className="ml-auto"
      >
        <MessageCircle className="size-4" aria-hidden />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onTheme}
        aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      >
        {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </Button>
    </header>
  )
}
