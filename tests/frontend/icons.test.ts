import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ArrowUp, Ellipsis, FileCode, FileImage, FileSpreadsheet, FileText, Layers, Sparkles } from 'lucide-react'
import { fileIcon, Icons } from '@/lib/icons'

// Icon discipline (F7): feature code takes icons from the semantic map
// only, and every icon-only button goes through IconButton (label +
// tooltip guaranteed).
const SRC = join(import.meta.dirname, '..', '..', 'frontend', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(tsx?)$/.test(entry) ? [full] : []
  })
}

const ICON_BUTTON = /<Button\b(?:(?!<Button|<\/Button|>)[\s\S])*?\bsize="icon(-sm)?"/

describe('icon discipline (F7)', () => {
  it('imports lucide-react only in the icon map and owned primitives', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      if (file.endsWith('/lib/icons.ts') || file.includes('/ui/')) return false
      return readFileSync(file, 'utf8').includes('lucide-react')
    })
    expect(offenders).toEqual([])
  })

  it('renders icon-only buttons only through IconButton', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      if (file.endsWith('/IconButton.tsx') || file.includes('/ui/')) return false
      return ICON_BUTTON.test(readFileSync(file, 'utf8'))
    })
    expect(offenders).toEqual([])
  })
})

describe('semantic icon map', () => {
  it('pins the core concept glyphs', () => {
    expect(Icons.sector).toBe(Layers)
    expect(Icons.karbot).toBe(Sparkles)
    expect(Icons.send).toBe(ArrowUp)
    expect(Icons.moreActions).toBe(Ellipsis)
  })

  it('maps every entry to a renderable icon', () => {
    for (const [name, icon] of Object.entries(Icons)) {
      expect(icon, name).toBeDefined()
    }
    expect(Object.keys(Icons).length).toBeGreaterThan(60)
  })

  it('picks file-type icons from the extension', () => {
    expect(fileIcon('report.pdf')).toBe(Icons.fileDocs)
    expect(fileIcon('notes.md')).toBe(Icons.fileDocs)
    expect(fileIcon('data.csv')).toBe(Icons.fileSpreadsheet)
    expect(fileIcon('sheet.xlsx')).toBe(Icons.fileSpreadsheet)
    expect(fileIcon('photo.png')).toBe(Icons.fileImage)
    expect(fileIcon('app.json')).toBe(Icons.fileCode)
    expect(fileIcon('archive.zip')).toBe(Icons.fileArchive)
    expect(fileIcon('mystery.xyz')).toBe(Icons.fileUnknown)
    expect(fileIcon('UPPER.PDF')).toBe(Icons.fileDocs)
    expect(Icons.fileDocs).toBe(FileText)
    expect(Icons.fileSpreadsheet).toBe(FileSpreadsheet)
    expect(Icons.fileImage).toBe(FileImage)
    expect(Icons.fileCode).toBe(FileCode)
  })
})
