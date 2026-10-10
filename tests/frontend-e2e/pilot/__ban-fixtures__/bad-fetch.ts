// Ban fixture: fetch (must fail pilot lint).
declare function fetch(url: string): Promise<unknown>
export async function bannedFetch(): Promise<unknown> {
  return fetch('/v1/sectors')
}
