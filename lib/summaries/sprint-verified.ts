/**
 * LUM-1278 — the "verified" predicate for a task, shared by the sprint
 * attention read model and LUM-1280.
 *
 * Pure: no prisma, no repository, no service — the rule must be readable and
 * testable without a database, and safe to import from client code.
 *
 * verified = status DONE
 *          AND the DONE gate is not blocked (and could be read — fail-closed)
 *          AND the task has at least one non-deleted test case
 *          AND every such case's latest run is PASS (after the provability
 *              ceiling) and fresh per `deriveRunFreshness`.
 *
 * A task with zero test cases is NOT verified — the gate's tests row reads
 * "none" for it, never "passing" (decision recorded on LUM-1278).
 */
import {
  deriveStoredRunCeiling,
  type CeilingEnvironment,
  type StoredCeilingRun,
} from '@/lib/test-cases/provability'
import {
  deriveRunFreshness,
  type RunCoordinate,
  type TaskPullRequestSnapshot,
} from '@/lib/test-cases/freshness'

/** One non-deleted test case with only its latest run (null = never run). */
export interface VerifiedCaseInput {
  requiredEnvironment: CeilingEnvironment | null
  latestRun: (StoredCeilingRun & RunCoordinate) | null
}

export interface TestTrust {
  /** Non-deleted test cases. */
  total: number
  /** Cases whose latest run is PASS after the provability ceiling. */
  passing: number
  /** The subset of `passing` whose run is fresh against its PR's code. */
  fresh: number
}

/**
 * Count passing and fresh cases. `prsById` holds the PRs a run may be bound
 * to; a run whose PR is missing reads `unknown`, never fresh.
 */
export function summarizeTestTrust(
  cases: VerifiedCaseInput[],
  prsById: ReadonlyMap<string, TaskPullRequestSnapshot>
): TestTrust {
  let passing = 0
  let fresh = 0
  for (const c of cases) {
    const run = c.latestRun
    if (!run) continue
    if (deriveStoredRunCeiling(run, c.requiredEnvironment).effective !== 'PASS')
      continue
    passing++
    const pr = run.pullRequestId
      ? (prsById.get(run.pullRequestId) ?? null)
      : null
    if (deriveRunFreshness(run, pr).state === 'fresh') fresh++
  }
  return { total: cases.length, passing, fresh }
}

/** The DONE gate as one word: `unknown` when a plane could not be read. */
export type GateState = 'clear' | 'blocked' | 'unknown'

export function isTaskVerified(input: {
  status: string
  gate: GateState
  tests: TestTrust
}): boolean {
  return (
    input.status === 'DONE' &&
    input.gate === 'clear' &&
    input.tests.total > 0 &&
    input.tests.fresh === input.tests.total
  )
}

/**
 * LUM-1280 — when a verified task became verified: the later of its last move
 * to DONE and the newest latest-run among its cases (the last piece of
 * evidence to land). Null when not verified or no instant is known. Gate
 * dispositions are not timestamped here, so a late ruling does not move it.
 */
export function verifiedAt(input: {
  verified: boolean
  doneAt: Date | null
  latestRunAts: ReadonlyArray<Date | null>
}): Date | null {
  if (!input.verified) return null
  let latest = input.doneAt?.getTime() ?? null
  for (const at of input.latestRunAts) {
    const t = at?.getTime()
    if (t !== undefined && (latest === null || t > latest)) latest = t
  }
  return latest === null ? null : new Date(latest)
}
