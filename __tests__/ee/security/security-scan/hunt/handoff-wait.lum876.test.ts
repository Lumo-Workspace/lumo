/** @jest-environment node */
/**
 * LUM-876 — the hunt's pre-batch hand-off wait used to spend its whole 240 s
 * window looking for a managed scan VM that was never coming (create failed,
 * the VM was stopped after a failed revoke or seal, a superseded sha booted
 * none). Looking for the VM is now capped at the 30 s attach window; only a
 * VM that exists is waited on for the full hand-off window. Runs on fake
 * timers with the production defaults — no test seams for the windows.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/ee/security/integrations/vercel-sandbox', () => ({
  findRepoSandboxByTag: jest.fn(),
  createRepoSandbox: jest.fn(),
  denySandboxEgress: jest.fn(),
  repoCheckoutDir: jest.fn(),
}))
jest.mock('@/lib/integrations/github/auth', () => ({
  getRepoCloneToken: jest.fn(),
  revokeInstallationToken: jest.fn(),
}))

import { awaitManagedScanHandOff } from '@/ee/security/services/security-hunt-sandbox'
import { findRepoSandboxByTag } from '@/ee/security/integrations/vercel-sandbox'
import {
  HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS,
  HUNT_SANDBOX_ATTACH_POLL_MS,
  HUNT_SANDBOX_ATTACH_WAIT_MS,
} from '@/ee/security/services/security-hunt.config'
import { MANAGED_SCAN_DONE_PATH } from '@/ee/security/services/security-managed-scan.config'

const find = findRepoSandboxByTag as jest.Mock

/** A managed scan VM whose marker shows up `markerAtMs` after the test starts. */
function managedVm(start: number, markerAtMs: number) {
  return {
    name: 'managed',
    cwd: '/vercel',
    readFile: jest.fn(async (path: string) =>
      path === MANAGED_SCAN_DONE_PATH && Date.now() - start >= markerAtMs
        ? Buffer.from('')
        : null
    ),
    stop: jest.fn(),
  }
}

/** Runs the wait to completion on fake time; returns its result and the fake ms it took. */
async function runWait(): Promise<{ result: boolean; tookMs: number }> {
  const start = Date.now()
  let settled: boolean | undefined
  const pending = awaitManagedScanHandOff({ scanId: 's1' }).then(r => {
    settled = r
  })
  // Step in poll-sized slices so we learn WHEN it settled, not just that it did.
  while (settled === undefined) {
    await jest.advanceTimersByTimeAsync(HUNT_SANDBOX_ATTACH_POLL_MS)
    if (Date.now() - start > HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS * 2) break
  }
  await pending
  return { result: settled!, tookMs: Date.now() - start }
}

beforeEach(() => {
  jest.resetAllMocks()
  jest.useFakeTimers()
})

afterEach(() => {
  jest.useRealTimers()
})

describe('LUM-876 hand-off wait', () => {
  it('LUM-876 hand-off wait gives up after the attach window when no VM appears', async () => {
    // The two windows this behaviour lives between really are different.
    expect(HUNT_SANDBOX_ATTACH_WAIT_MS).toBeLessThan(
      HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS
    )
    find.mockResolvedValue(null)

    const { result, tookMs } = await runWait()

    expect(result).toBe(false)
    // Gave up within one poll of the 30 s attach window — not the 240 s one.
    expect(tookMs).toBeGreaterThanOrEqual(HUNT_SANDBOX_ATTACH_WAIT_MS)
    expect(tookMs).toBeLessThanOrEqual(
      HUNT_SANDBOX_ATTACH_WAIT_MS + HUNT_SANDBOX_ATTACH_POLL_MS
    )
    expect(find.mock.calls.length).toBeLessThanOrEqual(
      Math.ceil(HUNT_SANDBOX_ATTACH_WAIT_MS / HUNT_SANDBOX_ATTACH_POLL_MS) + 1
    )
  })

  it('LUM-876 hand-off wait runs to the full window once the VM is found', async () => {
    const start = Date.now()
    // The VM shows up 20 s in (inside the attach window); the managed scan
    // finishes 200 s in — well past the attach window, inside the hand-off one.
    const markerAtMs = 200_000
    expect(markerAtMs).toBeGreaterThan(HUNT_SANDBOX_ATTACH_WAIT_MS)
    expect(markerAtMs).toBeLessThan(HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS)
    const vm = managedVm(start, markerAtMs)
    find.mockImplementation(async () =>
      Date.now() - start >= 20_000 ? vm : null
    )

    const { result, tookMs } = await runWait()

    expect(result).toBe(true)
    expect(tookMs).toBeGreaterThanOrEqual(markerAtMs)
    expect(tookMs).toBeLessThan(HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS)

    // Control: a found VM that never finishes is waited on until the full
    // hand-off window, and no longer.
    const slow = managedVm(Date.now(), Infinity)
    find.mockResolvedValue(slow)
    const never = await runWait()
    expect(never.result).toBe(false)
    expect(never.tookMs).toBeGreaterThanOrEqual(
      HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS
    )
    expect(never.tookMs).toBeLessThanOrEqual(
      HUNT_MANAGED_SCAN_HANDOFF_WAIT_MS + HUNT_SANDBOX_ATTACH_POLL_MS
    )
  })
})
