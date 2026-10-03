// ThemeMenu (SH-04): the single theme control, used in the TopBar and the
// workspace rail footer. The trigger shows the preference icon (Monitor
// for system, Sun/Moon for a manual choice) with a "Theme" tooltip; the
// menu offers System / Light / Dark radio items with the active one
// marked. Controlled: App owns useTheme and passes preference down so
// the Toaster theme and every menu stay in sync.
//
// The trigger is an IconButton (label + tooltip guaranteed) with the
// menu trigger composed over it via Base UI render chaining; React 19
// ref-as-prop carries the menu anchor through to the button.
import { useState } from 'react'
import { Icons } from '@/lib/icons'
import type { ThemePreference } from '@/lib/theme'
import { IconButton } from './IconButton'
import { MenuPopup, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from './ui/menu'

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Icons.themeLight }> = [
  { value: 'system', label: 'System', icon: Icons.themeSystem },
  { value: 'light', label: 'Light', icon: Icons.themeLight },
  { value: 'dark', label: 'Dark', icon: Icons.themeDark },
]

export function ThemeMenu({
  preference,
  onPreference,
  side = 'bottom',
}: {
  preference: ThemePreference
  onPreference: (next: ThemePreference) => void
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const TriggerIcon =
    preference === 'system' ? Icons.themeSystem : preference === 'light' ? Icons.themeLight : Icons.themeDark
  // Base UI radio items keep the menu open for multi-change menus; a
  // theme choice applies instantly, so dismiss on select (controlled).
  const [open, setOpen] = useState(false)
  return (
    <MenuRoot open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <IconButton label="Theme" size="icon-sm" side={side}>
            <TriggerIcon className="size-4" aria-hidden />
          </IconButton>
        }
      />
      <MenuPopup>
        <MenuRadioGroup
          aria-label="Theme"
          value={preference}
          onValueChange={(value) => {
            onPreference(value as ThemePreference)
            setOpen(false)
          }}
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <MenuRadioItem key={value} value={value}>
              <Icon className="size-4 text-muted-foreground" aria-hidden />
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </MenuRoot>
  )
}
