import { Icons } from '@/lib/icons'
import { SearchField } from './shells'
import { IconButton } from './IconButton'

export function TopBar({
  query,
  onQuery,
  dark,
  onTheme,
  chatOpen,
  onChatToggle,
  showSearch,
}: {
  query: string
  onQuery: (value: string) => void
  dark: boolean
  onTheme: () => void
  chatOpen: boolean
  onChatToggle: () => void
  /** Overview-only search: other pages must not offer a control that has no
   * effect there. The query lives in App, so returning to Overview keeps it. */
  showSearch: boolean
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-6">
      {showSearch ? (
        <div className="max-w-sm flex-1">
          <SearchField
            value={query}
            onChange={onQuery}
            label="Search researches"
            placeholder="Search researches on Overview"
          />
        </div>
      ) : (
        <div className="min-w-0 flex-1" aria-hidden />
      )}
      <IconButton label={chatOpen ? 'Close chat' : 'Open chat'} size="icon" variant="outline" onClick={onChatToggle} aria-expanded={chatOpen} className="ml-auto">
        <Icons.messageCircle className="size-4" aria-hidden />
      </IconButton>
      <IconButton label={dark ? 'Switch to light theme' : 'Switch to dark theme'} size="icon" variant="outline" onClick={onTheme}>
        {dark ? <Icons.themeLight className="size-4" aria-hidden /> : <Icons.themeDark className="size-4" aria-hidden />}
      </IconButton>
    </header>
  )
}
