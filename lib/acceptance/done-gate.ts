/**
 * LUM-1009 — the Done gate: one headline plus one row per gate (boundary
 * crossings, security scan, test cases), derived from the gap counts. Pure —
 * no intl, no fetching, no prisma — so the web Record tab (`RecordDoneGate`)
 * and the server's task-status read model (LUM-1186, rendered by
 * `lumo task status` / `task wrapup`) run the SAME rule and cannot disagree.
 */
import type {
  DoneRequirementSwitches,
  MissingRequirement,
} from './done-requirements'

/** unconfirmed: nothing known blocks, but the requirements could not be
 *  read (web only — the server never derives a gate it could not read). */
export type DoneGateHeadline = 'accepted' | 'blocked' | 'ready' | 'unconfirmed'

export interface CrossingsGateRow {
  /** blocked: a blocking crossing is open · advisory: only non-blocking ones
   *  are open · clear: every crossing dispositioned · none: none recorded. */
  state: 'blocked' | 'advisory' | 'clear' | 'none'
  blocking: number
  /** Open crossings that need a disposition but do not block Done. */
  advisory: number
  dispositioned: number
  total: number
}

export interface SecurityGateRow {
  /** notScanned: the task has no scanned PR — never reported as clean. */
  state: 'blocked' | 'clear' | 'notScanned'
  blocking: number
}

export interface TestsGateRow {
  /** blocked: a proven defect awaits a ruling · clear: none · none: the task
   *  has no test cases (never reported as passing). */
  state: 'blocked' | 'clear' | 'none'
  blocking: number
  passing: number
  total: number
}

/**
 * LUM-1334 — the workspace's opt-in requirements (a passing test case / a
 * review on each PR's latest commit). Only present while a switch is on.
 */
export interface RequirementsGateRow {
  /** blocked: some counted PR misses a requirement · clear: none does ·
   *  unconfirmed: whether a switch is on could not be read. */
  state: 'blocked' | 'clear' | 'unconfirmed'
  switches: DoneRequirementSwitches
  missing: MissingRequirement[]
}

export interface DoneGate {
  headline: DoneGateHeadline
  /** Items that hold Done back: blocking crossings + blocking findings +
   *  undispositioned proven test defects + missing requirements (LUM-1334). */
  blockingTotal: number
  crossings: CrossingsGateRow
  /** null when no plugin contributes a security check (LUM-1062). */
  security: SecurityGateRow | null
  tests: TestsGateRow
  /** LUM-1334: null while both requirement switches are off. */
  requirements: RequirementsGateRow | null
}

/**
 * The counts the gate is derived from. The web's `RecordGaps` is a superset;
 * the server builds the same counts from its own reads (LUM-1186).
 */
export interface DoneGateCounts {
  /** Crossings with no disposition yet, blocking or not. */
  crossingsOpen: number
  /** The subset of `crossingsOpen` that blocks Done (not advisory, and the
   *  workspace gate is on or the crossing is HIGH). */
  crossingsBlocking: number
  crossingsTotal: number
  /** Undispositioned security findings that block DONE. */
  securityBlocking: number
  /** Undispositioned proven test defects (latest run per case, LUM-812). */
  testsBlocking: number
  taskDone: boolean
}

export function deriveDoneGate(
  gaps: DoneGateCounts,
  opts: {
    securityScanned: boolean
    /** LUM-1062: false without a plugin — no security row at all. */
    showSecurity?: boolean
    /** LUM-1011: test-case counts for the gate row's detail. */
    tests?: { total: number; passing: number }
    /** LUM-1334: the requirement switches and what the PRs miss, or
     *  'unconfirmed' when they could not be read. */
    requirements?:
      | {
          switches: DoneRequirementSwitches
          missing: MissingRequirement[]
        }
      | 'unconfirmed'
      | null
  }
): DoneGate {
  const advisory = gaps.crossingsOpen - gaps.crossingsBlocking
  const crossingsState: CrossingsGateRow['state'] =
    gaps.crossingsTotal === 0
      ? 'none'
      : gaps.crossingsBlocking > 0
        ? 'blocked'
        : advisory > 0
          ? 'advisory'
          : 'clear'

  const securityState: SecurityGateRow['state'] =
    gaps.securityBlocking > 0
      ? 'blocked'
      : opts.securityScanned
        ? 'clear'
        : 'notScanned'

  const testsTotal = opts.tests?.total ?? 0
  const testsState: TestsGateRow['state'] =
    gaps.testsBlocking > 0 ? 'blocked' : testsTotal > 0 ? 'clear' : 'none'

  const req = opts.requirements
  const requirements: RequirementsGateRow | null =
    req === 'unconfirmed'
      ? {
          state: 'unconfirmed',
          switches: { testCase: false, review: false },
          missing: [],
        }
      : req && (req.switches.testCase || req.switches.review)
        ? {
            state: req.missing.length > 0 ? 'blocked' : 'clear',
            switches: req.switches,
            missing: req.missing,
          }
        : null

  const blockingTotal =
    gaps.crossingsBlocking +
    gaps.securityBlocking +
    gaps.testsBlocking +
    (requirements?.missing.length ?? 0)

  return {
    headline: gaps.taskDone
      ? 'accepted'
      : blockingTotal > 0
        ? 'blocked'
        : requirements?.state === 'unconfirmed'
          ? 'unconfirmed'
          : 'ready',
    blockingTotal,
    crossings: {
      state: crossingsState,
      blocking: gaps.crossingsBlocking,
      advisory,
      dispositioned: gaps.crossingsTotal - gaps.crossingsOpen,
      total: gaps.crossingsTotal,
    },
    security:
      opts.showSecurity === false
        ? null
        : { state: securityState, blocking: gaps.securityBlocking },
    tests: {
      state: testsState,
      blocking: gaps.testsBlocking,
      passing: opts.tests?.passing ?? 0,
      total: testsTotal,
    },
    requirements,
  }
}

/**
 * LUM-1186 — the Done gate as the task-status read model serves it. Fail-
 * closed: when any plane behind the gate could not be read the server sends
 * `confirmed: false` with what it could not read — never a guessed headline.
 */
export type DoneGateReadout =
  | ({ confirmed: true } & DoneGate)
  | { confirmed: false; unconfirmed: string[] }

/**
 * LUM-1186 — what the server read for the gate, before the task's status is
 * known (the reads run in parallel with the header read). `doneGateReadout`
 * finishes it.
 */
export type DoneGateInputs =
  | {
      confirmed: true
      counts: Omit<DoneGateCounts, 'taskDone'>
      opts: Parameters<typeof deriveDoneGate>[1]
    }
  | { confirmed: false; unconfirmed: string[] }

export function doneGateReadout(
  inputs: DoneGateInputs,
  taskStatus: string
): DoneGateReadout {
  if (!inputs.confirmed) return inputs
  return {
    confirmed: true,
    ...deriveDoneGate(
      { ...inputs.counts, taskDone: taskStatus === 'DONE' },
      inputs.opts
    ),
  }
}
