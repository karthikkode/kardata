// Layer contract errors (B7.1). Every public db/ function parses its
// input with zod and throws DbContractError on misalignment — bad shape,
// empty idempotency key, over-long partition, negative limit. Callers map
// it to existing envelopes (400/404/409); the layer defines no HTTP
// semantics of its own.
export class DbContractError extends Error {
  readonly code = 'db_contract'

  constructor(message: string, options?: ErrorOptions) {
    super(`db contract: ${message}`, options)
    this.name = 'DbContractError'
  }
}

export class WorkspaceError extends Error {
  constructor(readonly code: 'not_found' | 'conflict' | 'permission_denied' | 'validation_failed', message: string, options?: ErrorOptions) { super(message, options) }
}

export class ArtifactImportTimeout extends Error {
  readonly code = 'artifact_import_timeout'
  constructor() { super('Artifact import deadline exceeded; retained partial records require verification before reuse.') }
}
