// third_party manifest validation. Policy lives in third_party/README.md.
// Every pin needs repo, SHA, license, license path, and at least one taken entry.
export interface ManifestTaken {
  path: string
  kind: 'pattern' | 'verbatim'
}

export interface ManifestPin {
  donor: string
  repo: string
  sha: string
  license: string
  licensePath: string
  taken: ManifestTaken[]
}

export interface Manifest {
  pins: ManifestPin[]
}

const SHA_RE = /^[0-9a-f]{40}$/

export function validateManifest(manifest: Manifest): string[] {
  const errors: string[] = []
  if (!manifest || !Array.isArray(manifest.pins)) {
    return ['manifest.pins must be an array']
  }
  manifest.pins.forEach((pin, index) => {
    const where = `pins[${index}]`
    if (!pin.donor) errors.push(`${where}.donor is required`)
    if (!pin.repo) errors.push(`${where}.repo is required`)
    if (!pin.sha || !SHA_RE.test(pin.sha)) errors.push(`${where}.sha must be a full 40-hex commit SHA`)
    if (!pin.license) errors.push(`${where}.license is required`)
    if (!pin.licensePath) errors.push(`${where}.licensePath is required`)
    if (!Array.isArray(pin.taken) || pin.taken.length === 0) {
      errors.push(`${where}.taken needs at least one entry`)
    } else {
      pin.taken.forEach((entry, takenIndex) => {
        if (!entry.path) errors.push(`${where}.taken[${takenIndex}].path is required`)
        if (entry.kind !== 'pattern' && entry.kind !== 'verbatim') {
          errors.push(`${where}.taken[${takenIndex}].kind must be pattern or verbatim`)
        }
      })
    }
  })
  return errors
}
