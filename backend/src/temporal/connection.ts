// Temporal connectivity. B2.1. Self-hosted server (compose for dev/staging;
// address overridable for tests). Workers use NativeConnection; workflow
// starters use the client Connection; both honor the same address.
import { Connection } from '@temporalio/client'
import { NativeConnection } from '@temporalio/worker'

export function temporalAddress(): string {
  return process.env['TEMPORAL_ADDRESS'] ?? 'localhost:7233'
}

export function temporalNamespace(): string {
  return process.env['TEMPORAL_NAMESPACE'] ?? 'default'
}

export async function connectWorker(): Promise<NativeConnection> {
  return NativeConnection.connect({ address: temporalAddress() })
}

export async function connectClient(): Promise<Connection> {
  return Connection.connect({ address: temporalAddress() })
}
