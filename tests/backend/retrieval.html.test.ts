import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { sourceHtmlText } from '../../backend/src/retrieval/html.js'

describe('source HTML extraction', () => {
  it('keeps visible text while discarding attributes, comments and ignored content', () => {
    expect(sourceHtmlText('<div title="hidden > attribute">Acme<!--secret--><script>private</script><style>css</style><p>Widgets &amp; services</p></div>')).toBe('Acme Widgets & services')
    expect(sourceHtmlText('Visible<script>not source')).toBe('Visible')
    expect(sourceHtmlText('Visible<div title="unterminated')).toBe('Visible')
    expect(sourceHtmlText('<script>not source</scripture><p>still script</p></script>Visible')).toBe('Visible')
  })
  it('keeps tag offsets when Unicode case folding would expand ignored content', () => {
    expect(sourceHtmlText(`İ before<ScRiPt>${'İ'.repeat(10)}</sCrIpT>Visible company<StYlE>İ</sTyLe> after`)).toBe('İ before Visible company after')
  })
  it('handles adversarial under-cap HTML in an isolated time/memory-bounded process', () => {
    const source = readFileSync(join(import.meta.dirname, '../../backend/src/retrieval/html.ts'), 'utf8')
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const program = `${js}\nconst malformed = '<script>'.repeat(250000); const value = sourceHtmlText(malformed); console.log(JSON.stringify({length:value.length}));`
    // Own child only; a regressed parser cannot monopolize the shared runner.
    const output = execFileSync(process.execPath, ['--max-old-space-size=64','--input-type=module','-e',program], { encoding: 'utf8', timeout: 2000, maxBuffer: 4096 })
    expect(JSON.parse(output)).toEqual({ length: 0 })
  })
})
