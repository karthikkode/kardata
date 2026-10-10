// Ban fixture: page.request (must fail pilot lint).
interface PilotPage {
  request: { get(url: string): Promise<unknown> }
}
export async function bannedPageRequest(page: PilotPage): Promise<unknown> {
  return page.request.get('/v1/sectors')
}
