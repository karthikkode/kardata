export interface RegistrySurface {
  id: string
  layer: string
  surface: string
}

export interface RegistryEntry extends RegistrySurface {
  tiers: string[]
  states: string[]
  why?: string
}

export interface RegistryTag {
  id: string
  file: string
  tiers: string[]
}

export interface RegistryCheck {
  missing: string[]
  unknown: Array<{ id: string; file: string }>
  todo: string[]
  gaps: Array<{ id: string; tier: string }>
}

export function valueExports(text: string, file: string): string[]
export function enumerateSurfaces(repoRoot?: string): RegistrySurface[]
export function loadRegistry(repoRoot?: string): RegistryEntry[]
export function mergeRegistry(
  oldEntries: RegistryEntry[],
  surfaces: RegistrySurface[],
): { entries: RegistryEntry[]; added: string[]; removed: string[] }
export function tierOfFile(relPath: string, content?: string): string
export function scanTags(repoRoot?: string): RegistryTag[]
export function checkRegistry(
  entries: RegistryEntry[],
  surfaces: RegistrySurface[],
  tags: RegistryTag[],
  opts?: { enforce?: boolean },
): RegistryCheck
