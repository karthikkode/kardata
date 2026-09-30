import { createHmac, timingSafeEqual } from 'node:crypto'
export function verifyExecution(thread: string, signature: string, token: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false
  const expected = createHmac('sha256', token).update(thread).digest('hex')
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
