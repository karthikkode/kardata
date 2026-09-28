// Usage/cost ledger projection. B1.3. Costs ride events as decimal strings
// and land in NUMERIC so totals are exact; presentation rounds half-up to
// cents with formatCents. Re-projection is idempotent: ledger rows carry
// their source event seq with a uniqueness guard, and rebuild truncates
// before replaying.
// Pure ledger helpers (B7.6): the usage payload schema, cost presentation,
// and totals shape. Projection SQL lives in backend/src/db/ledger.ts.
import { z } from 'zod'

export const UsageRecorded = z.object({
  runId: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cost: z.string().regex(/^\d+(\.\d+)?$/, 'cost must be a non-negative decimal string'),
})

/** Round a non-negative decimal string half-up to two places. */
export function formatCents(amount: string): string {
  const [whole = '0', fraction = ''] = amount.split('.')
  const thousandths = Number((fraction + '000')[2])
  let cents = BigInt(whole === '' ? '0' : whole) * 100n + BigInt((fraction + '00').slice(0, 2) || '0')
  if (thousandths >= 5) cents += 1n
  const dollars = cents / 100n
  const remainder = String(cents % 100n).padStart(2, '0')
  return `${dollars}.${remainder}`
}
