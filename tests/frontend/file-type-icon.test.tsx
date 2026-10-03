import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileTypeIcon } from '@/components/FileTypeIcon'
import { Icons, fileExtension, fileIcon } from '@/lib/icons'

describe('fileExtension', () => {
  it('lowercases the suffix after the last dot', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf')
    expect(fileExtension('archive.tar.gz')).toBe('gz')
  })

  it('returns the whole lowercased name when there is no dot', () => {
    expect(fileExtension('README')).toBe('readme')
  })
})

describe('fileIcon', () => {
  it('maps each family to its semantic glyph', () => {
    expect(fileIcon('brief.pdf')).toBe(Icons.fileDocs)
    expect(fileIcon('notes.md')).toBe(Icons.fileDocs)
    expect(fileIcon('data.csv')).toBe(Icons.fileSpreadsheet)
    expect(fileIcon('shot.png')).toBe(Icons.fileImage)
    expect(fileIcon('graph.json')).toBe(Icons.fileCode)
    expect(fileIcon('bundle.zip')).toBe(Icons.fileArchive)
  })

  it('falls back to the unknown glyph', () => {
    expect(fileIcon('odd.xyz')).toBe(Icons.fileUnknown)
    expect(fileIcon('README')).toBe(Icons.fileUnknown)
  })
})

describe('FileTypeIcon', () => {
  it('renders the mapped glyph with the given props', () => {
    const { container } = render(<FileTypeIcon filename="plan.pdf" aria-hidden className="size-4" />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('size-4')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
  })
})
