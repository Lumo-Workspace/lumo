import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const STATE_FILE = '.lumo-sync.json'
const DEFAULT_HOURS = 12

/** Per-repo freshness state for the attach-triggered auto-downsync. */
export interface ThrottleState {
  /** ISO timestamp of the last successful auto-downsync. */
  lastSyncAt: string
  /** Project whose memory was synced — a different project is never throttled. */
  projectId: string
}

function statePath(dir: string): string {
  return join(dir, STATE_FILE)
}

/** Read the throttle state; null on missing / unreadable / malformed file. */
export function readThrottleState(dir: string): ThrottleState | null {
  const p = statePath(dir)
  if (!existsSync(p)) return null
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<ThrottleState>
    if (
      typeof parsed.lastSyncAt === 'string' &&
      typeof parsed.projectId === 'string'
    ) {
      return { lastSyncAt: parsed.lastSyncAt, projectId: parsed.projectId }
    }
    return null
  } catch {
    return null
  }
}

/** Best-effort write of the throttle state. Never throws. */
export function writeThrottleState(
  dir: string,
  state: ThrottleState,
  // accepted for signature symmetry with the caller; not otherwise needed.
  _now: Date = new Date()
): void {
  try {
    writeFileSync(statePath(dir), JSON.stringify(state) + '\n')
  } catch {
    // best-effort — a missing dir or read-only fs just means no throttle next time
  }
}

/** Remove the throttle state file (used by `memory sync --clean`). Never throws. */
export function clearThrottleState(dir: string): void {
  try {
    rmSync(statePath(dir), { force: true })
  } catch {
    // best-effort
  }
}

/** The throttle window in hours: LUMO_SYNC_THROTTLE_HOURS or the 12h default. */
export function throttleHours(): number {
  const raw = process.env.LUMO_SYNC_THROTTLE_HOURS
  if (!raw) return DEFAULT_HOURS
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURS
}

/**
 * True when a fresh sync for `projectId` exists within `hours` of `now`. A null
 * state, a different project, or a stale timestamp all return false (sync runs).
 */
export function isThrottled(
  state: ThrottleState | null,
  now: Date,
  hours: number,
  projectId: string
): boolean {
  if (!state || state.projectId !== projectId) return false
  const last = Date.parse(state.lastSyncAt)
  if (!Number.isFinite(last)) return false
  return now.getTime() - last < hours * 3600_000
}
