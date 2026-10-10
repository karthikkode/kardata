// Ban fixture: fetch inside page.evaluate (must fail pilot lint).
declare function fetch(url: string): Promise<unknown>
interface PilotPage {
  evaluate<T>(fn: () => T): Promise<T>
}
export async function bannedEvaluate(page: PilotPage): Promise<unknown> {
  return page.evaluate(() => fetch('/v1/sectors'))
}
