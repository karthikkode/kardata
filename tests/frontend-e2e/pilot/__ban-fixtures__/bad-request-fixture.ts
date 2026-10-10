// Ban fixture: request fixture (must fail pilot lint).
interface PilotRequest {
  get(url: string): Promise<unknown>
}
export async function bannedRequestFixture(request: PilotRequest): Promise<unknown> {
  return request.get('/v1/sectors')
}
