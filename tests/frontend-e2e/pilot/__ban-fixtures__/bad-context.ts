// Ban fixture: APIRequestContext (must fail pilot lint).
declare type APIRequestContext = { get(url: string): Promise<unknown> }
export type BannedContext = APIRequestContext
