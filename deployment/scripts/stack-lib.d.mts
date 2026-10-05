export interface HostWorker {
  pid: number | string
  user: string
  cmd: string
}

export interface Verdict {
  level: 'pass' | 'warn' | 'fail'
  detail: string
  fix: string[]
}

export interface HostProc {
  pid: string
  user: string
  cwd: string
  cmd: string
}

export function parseEnvFile(text: string): Record<string, string>
export function countRepoTools(schemasTs: string): number
export function fleetVerdict(args: {
  hostWorkers: HostWorker[]
  composeWorkerRunning: boolean
}): Verdict
export function freshnessVerdict(args: {
  service: string
  labelSha: string | null
  headSha: string
  headSubject: string
}): Verdict
export function parityVerdict(args: { served: number | null; repo: number }): Verdict
export function formatVerdict(name: string, verdict: Verdict): string
export function ownedTestProcs(
  processes: HostProc[],
  args: { repoRoot: string; user: string },
): { kill: HostProc[]; notes: string[] }
