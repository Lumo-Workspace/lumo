import { trimTrailingSlash } from './api'

/** Severity tiers, mirrored from the server's `BoundaryCrossingSeverity` (LUM-442). */
export type CrossingSeverity = 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * One OPEN (undispositioned) boundary crossing, narrowed to what the terminal
 * surfaces (LUM-448): just enough to know what was flagged and how serious. A
 * read-only mirror of the LUM-435 web read model — no disposition fields, no
 * write path.
 */
/** Read-only attribution for a crossing (LUM-469): which model + which
 *  agent/session committed it. Null on any dimension that couldn't be resolved
 *  server-side ("unknown" — never fabricated). Owner name isn't resolved in the
 *  terminal (no Clerk lookup); the member id + agent/session answer "whose". */
export interface CrossingAttribution {
  workspaceMemberId: string | null
  sessionId: string | null
  agent: string | null
  worktreeBranch: string | null
  model: string | null
}

export interface OpenCrossing {
  id: string
  category: string
  severity: CrossingSeverity
  /** One-line-able detail of what tripped the detector. */
  detail: string
  /** Who/what crossed (LUM-469) — model + agent/session attribution. */
  attribution: CrossingAttribution
  /** LUM-590: advisory crossings surface but never block DONE. */
  advisory: boolean
  /** LUM-771: whether the server DONE gate counts this row — the panel /
   *  `assertNoUnacknowledgedBoundaryCrossings` predicate, computed here so every
   *  terminal surface agrees with the server instead of listing all open rows. */
  blocking: boolean
  /** LUM-780: why a SYSTEM re-judge made this row advisory (its cause no
   *  longer holds) — the evidence line; null when never re-judged or against
   *  an older server that does not send the trail. */
  rejudge: string | null
  /** LUM-841: what a user needs to rule on the row without a second read —
   *  recurrence, whether the action reached outside the repo, and the agent's
   *  own explanations (an unverified self-report). Absent on an older server:
   *  `occurrenceCount` 1, `reversible` null (unknown), `explanations` []. */
  occurrenceCount?: number
  reversible?: boolean | null
  explanations?: string[]
}

/**
 * LUM-771: the server's DONE-gate predicate for one open crossing (mirrors
 * `assertNoUnacknowledgedBoundaryCrossings` and the panel): an advisory row
 * never blocks; with the workspace gate disabled only HIGH rows block.
 */
export function blocksDone(
  c: { advisory: boolean; severity: CrossingSeverity },
  gateEnabled: boolean
): boolean {
  return !c.advisory && (gateEnabled || c.severity === 'HIGH')
}

/**
 * The outcome of a crossings read (LUM-480), explicitly separating a successful
 * read — `{ status: 'ok', crossings }`, the list possibly empty — from a check
 * FAILURE — `{ status: 'error', reason }` (transport / non-ok HTTP / unparseable
 * body). The previous best-effort shape collapsed both into `[]`, so one
 * endpoint hiccup read as "0 open / all clear": a safety signal failing *open*.
 * Callers must branch on `status` and surface a "check failed — could not
 * confirm" warning rather than implying zero.
 */
export type OpenCrossingsResult =
  | {
      status: 'ok'
      crossings: OpenCrossing[]
      /** LUM-635/771: the workspace's DONE gate for crossings; an older server
       *  that omits it is read as enabled (fail closed). */
      gateEnabled: boolean
    }
  | { status: 'error'; reason: string }

const SEVERITY_RANK: Record<CrossingSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

/** A crossing row as returned by `GET /api/tasks/[id]/boundary-crossings` — the
 *  full LUM-435 view; we read only the few fields the terminal needs. */
interface RawCrossing {
  id: string
  category: string
  severity: string
  detail: string
  disposition: string | null
  attribution?: Partial<CrossingAttribution> | null
  advisory?: boolean
  rejudge?: { evidence?: unknown } | null
  occurrenceCount?: unknown
  reversible?: unknown
  explanations?: Array<{ note?: unknown }> | null
}

/** Narrow the raw view's attribution to the terminal's read-only shape, every
 *  dimension defaulting to null (unknown) when absent or the wrong type. */
function normalizeAttribution(
  raw: Partial<CrossingAttribution> | null | undefined
): CrossingAttribution {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length > 0 ? v : null
  return {
    workspaceMemberId: str(raw?.workspaceMemberId),
    sessionId: str(raw?.sessionId),
    agent: str(raw?.agent),
    worktreeBranch: str(raw?.worktreeBranch),
    model: str(raw?.model),
  }
}

function normalizeSeverity(s: string): CrossingSeverity {
  return s === 'HIGH' || s === 'MEDIUM' || s === 'LOW' ? s : 'LOW'
}

/**
 * Fetch a task's OPEN (undispositioned) boundary crossings, highest-severity
 * first, via the EXISTING LUM-435 read endpoint — `GET …/boundary-crossings`
 * returns every crossing (open and dispositioned); we keep only the
 * undispositioned ones (`disposition == null`). This is the **read/awareness**
 * half of the acceptance loop: there is no new query and this helper cannot
 * clear anything — a ruling goes through `lumo crossing disposition` (exit-4
 * user approval, LUM-769) or the web panel.
 *
 * Fails *closed*, not open (LUM-480): any transport / non-ok HTTP / parse
 * failure returns `{ status: 'error', reason }` so the caller can say "check
 * failed — could not confirm" instead of mistaking a hiccup for "0 open / all
 * clear". A successful read returns `{ status: 'ok', crossings }`; the list is
 * empty only when the server genuinely reports no open crossings. Either way the
 * supplementary safety signal never throws into the caller's primary output (the
 * acceptance status, the wrap-up panel) — failure is a value, not an exception.
 */
export async function fetchOpenCrossings(
  apiUrl: string,
  token: string,
  taskIdentifier: string
): Promise<OpenCrossingsResult> {
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/${encodeURIComponent(
    taskIdentifier
  )}/boundary-crossings`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  let data: { crossings?: RawCrossing[]; gateEnabled?: unknown }
  try {
    data = (await res.json()) as {
      crossings?: RawCrossing[]
      gateEnabled?: unknown
    }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  const rows = Array.isArray(data.crossings) ? data.crossings : []
  // LUM-771: only an explicit `false` disables the gate — absent (older server)
  // or malformed reads as enabled, so a hiccup can never hide a blocker.
  const gateEnabled = data.gateEnabled !== false
  const crossings = rows
    .filter(c => c.disposition == null)
    .map(c => {
      const severity = normalizeSeverity(c.severity)
      const advisory = c.advisory === true
      return {
        id: c.id,
        category: c.category,
        severity,
        detail: c.detail,
        attribution: normalizeAttribution(c.attribution),
        advisory,
        blocking: blocksDone({ advisory, severity }, gateEnabled),
        rejudge:
          typeof c.rejudge?.evidence === 'string' &&
          c.rejudge.evidence.length > 0
            ? c.rejudge.evidence
            : null,
        occurrenceCount:
          typeof c.occurrenceCount === 'number' && c.occurrenceCount > 1
            ? c.occurrenceCount
            : 1,
        reversible: typeof c.reversible === 'boolean' ? c.reversible : null,
        explanations: (Array.isArray(c.explanations) ? c.explanations : [])
          .map(e => (typeof e?.note === 'string' ? e.note : ''))
          .filter(n => n.length > 0),
      }
    })
    // Blocking rows first, then by severity — what the human must act on leads.
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]
    )
  return { status: 'ok', crossings, gateEnabled }
}

/**
 * The web deep link where a human dispositions crossings in the panel — the
 * counterpart of `lumo crossing disposition` (LUM-769); the awareness surfaces
 * (task status, DONE_BLOCKED) point here. Built from the workspace slug +
 * identifier alone (the `/my-tasks/<id>` route needs no project slug), so no
 * extra fetch is required.
 */
export function dispositionUrl(
  apiUrl: string,
  workspaceSlug: string,
  taskIdentifier: string
): string {
  return `${trimTrailingSlash(apiUrl)}/workspace/${workspaceSlug}/my-tasks/${taskIdentifier}#boundary-crossings`
}
