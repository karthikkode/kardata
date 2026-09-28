import { useState } from 'react'
import {
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  FlaskConical,
  LayoutDashboard,
  Mail,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const items = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Researches', icon: FlaskConical },
  { label: 'Agents', icon: Bot },
  { label: 'Models', icon: Cpu },
  { label: 'Emails', icon: Mail, disabled: true },
]

export function Sidebar({
  active,
  onSelect,
}: {
  active: string
  onSelect: (item: string) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <aside className={cn('flex w-16 shrink-0 flex-col gap-1 border-r border-border bg-background p-2 md:p-4 sticky top-0 h-screen', !collapsed && 'md:w-56')}>
      <p className={cn('px-2 pb-2 text-lg font-semibold', collapsed ? 'hidden' : 'hidden md:block')}>Kardata</p>
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {items.map(({ label, icon: Icon, disabled }: { label: string; icon: typeof Bot; disabled?: boolean }) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              if (!disabled) onSelect(label)
            }}
            disabled={disabled}
            aria-label={disabled ? `${label} (coming soon)` : label}
            aria-current={!disabled && active === label ? 'page' : undefined}
            title={disabled ? 'Coming soon' : undefined}
            className={cn(
              'flex items-center justify-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted md:justify-start',
              !disabled && 'cursor-pointer',
              !disabled && active === label
                ? 'bg-muted font-medium text-foreground'
                : 'text-muted-foreground',
              disabled && 'cursor-default opacity-60',
              collapsed && 'md:justify-center',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className={cn(collapsed ? 'hidden' : 'hidden md:inline')}>{label}</span>
          </button>
        ))}
      </nav>
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-expanded={!collapsed}
        className="mt-auto hidden cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted md:flex"
      >
        {collapsed ? (
          <ChevronsRight className="size-4 shrink-0" aria-hidden />
        ) : (
          <ChevronsLeft className="size-4 shrink-0" aria-hidden />
        )}
        <span className={cn(collapsed ? 'hidden' : 'hidden md:inline')}>Collapse</span>
      </button>
    </aside>
  )
}
