// Continue-as-new trigger shared by session, parent, and child runs. P4.2.4.
// Pure (no SDK imports) so unit tests cover the matrix and the workflow
// bundler inlines it with zero native surface.
export const CAN_DEFAULT_EVENT_LIMIT = 10_000
export const CAN_DEFAULT_BYTE_LIMIT = 10 * 1024 * 1024

export function shouldContinueAsNew(
  historyLength: number,
  historySizeBytes: number,
  continueAsNewSuggested: boolean,
  eventLimit?: number,
  byteLimit?: number,
): boolean {
  if (continueAsNewSuggested) return true
  return (
    historyLength >= (eventLimit ?? CAN_DEFAULT_EVENT_LIMIT) ||
    historySizeBytes >= (byteLimit ?? CAN_DEFAULT_BYTE_LIMIT)
  )
}
