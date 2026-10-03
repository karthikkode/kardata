// Sidebar (SH-02): Supabase-like app rail. 240px expanded / 56px rail,
// persisted in localStorage; below 768px it is always the icon rail.
// The active background is one shared-layout span sliding between items;
// sector views (SectorDetail/SectorChat) count as Researches.
import { useEffect, useState } from 'react'
import { LazyMotion, domAnimation, m } from 'motion/react'
import { Icons } from '@/lib/icons'
import { navIndicatorTransition } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { IconButton } from './IconButton'
import { Badge } from './ui/badge'
import { TooltipPopup, TooltipRoot, TooltipTrigger } from './ui/tooltip'

export const SIDEBAR_STORAGE_KEY = 'kardata-sidebar'

const items = [
  { label: 'Overview', icon: Icons.overview },
  { label: 'Researches', icon: Icons.researches },
  { label: 'Agents', icon: Icons.agents },
  { label: 'Models', icon: Icons.models },
  { label: 'Emails', icon: Icons.emails, disabled: true },
]

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function Sidebar({ active, onSelect }: { active: string; onSelect: (item: string) => void }) {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed)
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded')
    } catch {
      // Storage unavailable: the choice still applies for this session.
    }
  }, [collapsed])

  // Sector views belong to Researches.
  const activeLabel = active === 'SectorDetail' || active === 'SectorChat' ? 'Researches' : active

  return (
    <aside
      className={cn(
        // Mobile rail keeps 40px touch targets: 56px minus the border
        // leaves 43px for buttons at px-1.5 (px-2 would give 39px).
        'sticky top-0 flex h-screen w-14 shrink-0 flex-col gap-1 border-r border-border-subtle bg-sidebar px-1.5 py-3 transition-[width] duration-base ease-out md:px-2',
        !collapsed && 'md:w-60',
      )}
    >
      <div className={cn('flex h-8 shrink-0 items-center gap-2 px-1', collapsed && 'justify-center px-0')}>
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary-soft text-ui font-medium text-primary-text"
        >
          K
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-all duration-base ease-out',
            collapsed ? 'md:max-w-0 md:opacity-0' : 'hidden md:inline md:max-w-full md:opacity-100',
          )}
        >
          Kardata
        </span>
      </div>
      <nav aria-label="Primary" className="flex flex-col gap-0.5">
        {items.map(({ label, icon: Icon, disabled }: { label: string; icon: typeof Icons.agents; disabled?: boolean }) => {
          const isActive = !disabled && activeLabel === label
          const button = (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (!disabled) onSelect(label)
              }}
              aria-disabled={disabled || undefined}
              aria-label={disabled ? `${label} (coming soon)` : undefined}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-ui font-medium transition-colors duration-fast ease-out-soft outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring pointer-coarse:h-10',
                collapsed && 'justify-center px-0',
                isActive
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground',
                disabled ? 'cursor-not-allowed opacity-60 hover:bg-transparent hover:text-muted-foreground' : 'cursor-pointer',
              )}
            >
              {isActive ? (
                <LazyMotion features={domAnimation}>
                  <m.span
                    data-slot="nav-indicator"
                    aria-hidden
                    layoutId="nav-active"
                    transition={navIndicatorTransition}
                    className="absolute inset-0 rounded-md bg-sidebar-active"
                  />
                </LazyMotion>
              ) : null}
              <Icon className="relative size-4 shrink-0" aria-hidden />
              <span
                className={cn(
                  'relative min-w-0 flex-1 truncate text-left transition-all duration-base ease-out',
                  collapsed ? 'md:max-w-0 md:opacity-0' : 'hidden md:inline md:max-w-full md:opacity-100',
                )}
              >
                {label}
              </span>
              {disabled ? (
                <Badge
                  className={cn(
                    'relative ml-auto shrink-0 transition-all duration-base ease-out',
                    collapsed ? 'md:max-w-0 md:opacity-0 md:overflow-hidden md:px-0' : 'hidden md:inline-flex',
                  )}
                >
                  Soon
                </Badge>
              ) : null}
            </button>
          )
          // Collapsed labels hide visually but stay reachable; a tooltip
          // exposes the destination. Emails always explains itself.
          if (!collapsed && !disabled) return button
          return (
            <TooltipRoot key={label}>
              <TooltipTrigger render={button} />
              <TooltipPopup side="right">
                {disabled ? 'Email tracking is coming soon' : label}
              </TooltipPopup>
            </TooltipRoot>
          )
        })}
      </nav>
      <div className="mt-auto hidden justify-center md:flex">
        <IconButton
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          side="right"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <Icons.sidebarExpand className="size-4" aria-hidden />
          ) : (
            <Icons.sidebarCollapse className="size-4" aria-hidden />
          )}
        </IconButton>
      </div>
    </aside>
  )
}
