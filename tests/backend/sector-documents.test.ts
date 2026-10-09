// Sector document extraction (Phase 5). Pure unit tests: no database,
// no network. Covers text formats, unsupported types, and corrupt
// binaries failing as validation errors before any SQL runs.
import { describe, expect, it } from 'vitest'
import { DbContractError } from '../../backend/src/db/index.js'
import { extractDocumentText, SECTOR_DOCUMENT_MAX_BYTES } from '../../backend/src/db/sector-documents.js'

const bytes = (text: string): Buffer => Buffer.from(text, 'utf8')

describe('extractDocumentText [F:db.index.DbContractError] [F:db.sector_documents.extractDocumentText] [F:db.sector_documents.SECTOR_DOCUMENT_MAX_BYTES] [F:db.errors.DbContractError]', () => {
  it('extracts markdown, text, csv, and json verbatim', async () => {
    for (const filename of ['notes.md', 'dump.txt', 'rows.csv', 'data.json']) {
      const { text, mediaType } = await extractDocumentText(filename, bytes('# hello\nbody'))
      expect(text).toContain('hello')
      expect(mediaType).toBe('text/plain')
    }
  })

  it('rejects empty, oversize, and nameless files', async () => {
    await expect(extractDocumentText('notes.md', bytes(''))).rejects.toBeInstanceOf(DbContractError)
    await expect(extractDocumentText('', bytes('x'))).rejects.toBeInstanceOf(DbContractError)
    await expect(
      extractDocumentText('big.md', Buffer.alloc(SECTOR_DOCUMENT_MAX_BYTES + 1)),
    ).rejects.toBeInstanceOf(DbContractError)
  })

  it('rejects unsupported types with the supported list', async () => {
    const failure = await extractDocumentText('deck.pptx', bytes('junk')).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(DbContractError)
    expect((failure as Error).message).toContain('.md')
  })

  it('fails corrupt pdf and docx binaries as validation errors', async () => {
    await expect(extractDocumentText('scan.pdf', bytes('not a pdf at all'))).rejects.toBeInstanceOf(DbContractError)
    await expect(extractDocumentText('doc.docx', bytes('not a zip at all'))).rejects.toBeInstanceOf(DbContractError)
  })
})
