// Layer contract errors (B7.1). Every public db/ function parses its
// input with zod and throws DbContractError on misalignment — bad shape,
// empty idempotency key, over-long partition, negative limit. Callers map
// it to existing envelopes (400/404/409); the layer defines no HTTP
// semantics of its own.
export class DbContractError extends Error {
  readonly code = 'db_contract'

  constructor(message: string) {
    super(`db contract: ${message}`)
    this.name = 'DbContractError'
  }
}
