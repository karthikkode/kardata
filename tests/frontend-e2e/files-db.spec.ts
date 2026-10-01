// Isolated production HTTP + Postgres + filesystem upload journey.
// No provider/Temporal claim: stream transport is stubbed, all file routes are real.
import { expect, test } from '@playwright/test'

test.use({ video: 'on' })

test('UI upload failure publishes nothing; retry previews and downloads exact bytes', async ({ page }) => {
  test.skip(!process.env.TEST_DATABASE_URL, 'needs TEST_DATABASE_URL for isolated production file routes')
  test.setTimeout(60_000)
  const [{ Pool }, { mkdtempSync }, { tmpdir }, { join }, { readFile }, { randomUUID }, { ensureTestDb }, { buildApp }, { FilesystemTarget }, db, { projectNewEvents }, { FakeRunsGateway }] = await Promise.all([
    import('pg'), import('node:fs'), import('node:os'), import('node:path'), import('node:fs/promises'), import('node:crypto'),
    import('../backend/db-helper.js'), import('../../backend/src/app.js'), import('../../backend/src/archive/targets.js'),
    import('../../backend/src/db/index.js'), import('../../backend/src/projector.js'), import('../backend/fake-gateway.js'),
  ])
  const pool = new Pool({ connectionString: await ensureTestDb('kardata_test_browser_files') })
  const archive = new FilesystemTarget(mkdtempSync(join(tmpdir(), 'kardata-browser-files-')))
  const app = buildApp({ pool, runs: new FakeRunsGateway(pool), archiveTarget: archive, corsOrigins: ['http://127.0.0.1:5174'] })
  const sectorId = `sec-${randomUUID()}`
  const filename = 'TEST UI retained evidence.md'
  const content = `# TEST UI retained evidence\n\n${'First evidence paragraph. '.repeat(120)}\n\nTEST browser indexing fault\n\n${'Second evidence paragraph. '.repeat(120)}`
  const bytes = Buffer.from(content)
  try {
    await db.createSector(pool, { sectorId, name: 'TEST isolated UI file recovery' }); await projectNewEvents(pool)
    await pool.query('CREATE TABLE test_browser_file_fault(enabled boolean NOT NULL)')
    await pool.query('INSERT INTO test_browser_file_fault VALUES(true)')
    await pool.query(`CREATE FUNCTION test_browser_file_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.text LIKE '%TEST browser indexing fault%' AND (SELECT enabled FROM test_browser_file_fault) THEN
        RAISE EXCEPTION 'TEST browser indexing unavailable'; END IF; RETURN NEW; END $$`)
    await pool.query('CREATE TRIGGER test_browser_unit_failure BEFORE INSERT ON sector_document_units FOR EACH ROW EXECUTE FUNCTION test_browser_file_failure()')
    const backendUrl = await app.listen({ host: '127.0.0.1', port: 0 })
    await page.route('**/v1/**', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/events')) { await route.fulfill({ contentType: 'text/event-stream', body: ': TEST file journey stream stub\n\n' }); return }
      const response = await route.fetch({ url: `${backendUrl}${url.pathname}${url.search}` })
      await route.fulfill({ response })
    })
    await page.goto(`/?section=SectorChat&sector=${sectorId}`)
    await expect(page.getByRole('heading', { name: 'Research', exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
    const upload = async () => {
      const response = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/sectors/${sectorId}/documents`))
      const chooser = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Upload file', exact: true }).click()
      await (await chooser).setFiles({ name: filename, mimeType: 'text/markdown', buffer: bytes })
      return response
    }
    expect((await upload()).status()).toBe(500)
    await expect(page.getByRole('alert')).toHaveText('The upload did not finish. Choose the file again to retry. Existing files are kept.')
    await expect(page.getByRole('button', { name: filename, exact: true })).toHaveCount(0)
    expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [sectorId])).rows).toEqual([])
    await page.screenshot({ path: 'test-results/visual/files-db-upload-failure.png', animations: 'disabled' })
    await pool.query('UPDATE test_browser_file_fault SET enabled=false')
    expect((await upload()).status()).toBe(201)
    const file = page.getByRole('button', { name: filename, exact: true })
    await expect(file).toBeVisible()
    await file.click()
    const preview = page.getByRole('dialog', { name: 'File preview' })
    await expect(preview.getByRole('heading', { name: 'TEST UI retained evidence' })).toBeVisible()
    const downloadEvent = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'Download original file' }).click()
    const download = await downloadEvent
    expect(download.suggestedFilename()).toBe(filename)
    expect(await readFile((await download.path())!)).toEqual(bytes)
    await page.screenshot({ path: 'test-results/visual/files-db-upload-recovered.png', animations: 'disabled' })
    await page.keyboard.press('Escape'); await expect(file).toBeFocused()
    expect((await upload()).status()).toBe(201); await expect(file).toHaveCount(1)
    expect((await pool.query('SELECT id FROM sector_documents WHERE sector_id=$1', [sectorId])).rows).toHaveLength(1)
  } finally { await app.close(); await pool.end() }
})
