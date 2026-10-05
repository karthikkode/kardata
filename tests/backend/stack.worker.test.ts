// stack.mjs worker replicas (P4.2): arg validation exits before any
// docker or process side effect. Hermetic subprocess runs only; the
// happy path needs compose and stays manual.
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const STACK = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deployment', 'scripts', 'stack.mjs')

function runStack(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [STACK, ...args], { timeout: 30_000 }, (error, stdout, stderr) => {
      if (error && (error as { killed?: boolean }).killed) {
        reject(error)
        return
      }
      resolve({ code: (error as { code?: number })?.code ?? 0, stdout, stderr })
    })
  })
}

describe('stack worker replicas', () => {
  it('lists the worker command in usage', async () => {
    const result = await runStack(['nope'])
    expect(result.code).toBe(1)
    expect(result.stdout).toContain('worker')
    expect(result.stdout).toContain('--replicas')
  })

  it.each([['0'], ['-1'], ['1.5'], ['many'], ['17']])('rejects --replicas %s before side effects', async (value) => {
    const result = await runStack(['worker', '--replicas', value])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--replicas must be an integer from 1 to 16')
  })

  it('rejects a missing --replicas value', async () => {
    const result = await runStack(['worker', '--replicas'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('--replicas must be an integer from 1 to 16')
  })
})
