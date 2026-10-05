// One live user at a time. The backend live battery (in-process app on
// BATTERY_PORT) and the live browser stack (scripts/live-stack.sh,
// backend on BROWSER_STACK_PORT) poll the same kardata-live Temporal
// namespace and task queues: whoever starts second steals the first's
// activities and fails them against the wrong database (sector-backend-v1
// handoff bug 13). Both sides probe the other's port and refuse to start.
export const BROWSER_STACK_PORT = 3101
export const BATTERY_PORT = 3102

export async function probeHealthz(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) })
    return response.ok
  } catch {
    return false
  }
}

export async function assertBrowserStackDown(isUp: () => Promise<boolean>): Promise<void> {
  if (await isUp()) {
    throw new Error(
      `live browser stack is up on port ${BROWSER_STACK_PORT}: its worker would steal this battery's ` +
        `activities and fail them against the wrong database. Stop it first: ./scripts/live-stack-stop.sh`,
    )
  }
}
