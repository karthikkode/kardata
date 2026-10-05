import { createHash } from 'node:crypto';
import { hashKey } from '../auth/keys.js';

/**
 * B3.4 per-caller rate limits and mutation idempotency.
 * Fixed-window counters in Postgres so every backend replica behind Compose
 * shares one budget. Sustained-boundary bursts up to 2x the quoted limit are
 * accepted staging semantics; B5.x may move to a token bucket.
 *
 * Pure helpers live here; the Postgres stores moved to backend/src/db/quotas.ts
 * (B7.3). Import the stores from '../db/index.js'.
 */

export function rateBucket(authHeader: string | undefined, ip: string): string {
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) {
      return `key:${hashKey(token)}`;
    }
  }
  return `ip:${ip || 'unknown'}`;
}

/** Canonical fingerprint of a mutation request; key reuse with a different
 *  fingerprint is a conflict rather than a replay. */
export function mutationFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method.toUpperCase()} ${path} ${JSON.stringify(body ?? null)}`)
    .digest('hex');
}


