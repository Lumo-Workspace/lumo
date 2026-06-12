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
}

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
 * half of the acceptance loop: there is no new query and, by construction, no
 * way to clear a crossing — disposition stays web + human-only
 * (LUM-426/435/422).
 *
 * Best-effort: any transport / HTTP / parse failure yields an empty list, so a
 * supplementary safety signal can never break the caller's primary output
 * (the acceptance status, the wrap-up panel).
 */
export async function fetchOpenCrossings(
  apiUrl: string,
  token: string,
  taskIdentifier: string
): Promise<OpenCrossing[]> {
  const url = `${trimTrailingSlash(apiUrl)}/api/tasks/${encodeURIComponent(
    taskIdentifier
  )}/boundary-crossings`
  let res: Response
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  } catch {
    return []
  }
  if (!res.ok) return []
  let data: { crossings?: RawCrossing[] }
  try {
    data = (await res.json()) as { crossings?: RawCrossing[] }
  } catch {
    return []
  }
  const rows = Array.isArray(data.crossings) ? data.crossings : []
  return rows
    .filter(c => c.disposition == null)
    .map(c => ({
      id: c.id,
      category: c.category,
      severity: normalizeSeverity(c.severity),
      detail: c.detail,
      attribution: normalizeAttribution(c.attribution),
    }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

/**
 * The web deep link where a HUMAN dispositions crossings. Disposition is
 * web-only and human-only (LUM-426/435/422); the terminal only ever points
 * here, it never clears anything itself. Built from the workspace slug +
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
