import { sanitizeField } from './sanitize'

/**
 * The server calls behind the `lumo crossing disposition` handshake (LUM-769),
 * shared by the single-crossing and the batch path (LUM-845): one task-scoped
 * read of the crossings and the per-crossing read-receipt request. Both fail
 * closed — an error is a value the caller turns into "nothing was written",
 * never a silent "not found" or an envelope without a receipt.
 */

export type CrossingDispositionTarget = 'FALSE_POSITIVE' | 'CONFIRMED'

/** The slice of the LUM-435 crossing view the envelope shows. */
export interface CrossingForDisposition {
  id: string
  /** LUM-1059: the human-readable `<TEAM>-X<n>` ref; absent on an older server. */
  ref?: string
  category: string
  severity: string
  detail: string
  occurrenceCount?: number
  reversible?: boolean
  advisory?: boolean
  disposition: string | null
  explanations?: Array<{ note: string; createdAt?: string }>
}

export type ReceiptResult =
  | {
      status: 'ok'
      receipt: string
      expiresAt: string
      readAt: string
      readAcknowledgedAt: string | null
    }
  | { status: 'error'; reason: string }

/** The handshake's server call (LUM-769): stage 1 without `acknowledge`,
 *  stage 2 with the stage-1 receipt in it. Fails closed — without a receipt
 *  no envelope is issued, because its confirmCommand could never be accepted. */
export async function requestReceipt(
  base: string,
  headers: Record<string, string>,
  taskId: string,
  crossingId: string,
  body: { disposition: CrossingDispositionTarget; acknowledge?: string }
): Promise<ReceiptResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings/${encodeURIComponent(crossingId)}/disposition/receipt`,
      {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    )
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as {
      error?: unknown
    } | null
    const detail =
      errBody && typeof errBody.error === 'string'
        ? ` — ${sanitizeField(errBody.error)}`
        : ''
    return { status: 'error', reason: `HTTP ${res.status}${detail}` }
  }
  let data: {
    receipt?: unknown
    expiresAt?: unknown
    readAt?: unknown
    readAcknowledgedAt?: unknown
  }
  try {
    data = (await res.json()) as typeof data
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  if (typeof data.receipt !== 'string' || data.receipt.length === 0) {
    return { status: 'error', reason: 'no receipt in response' }
  }
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    status: 'ok',
    receipt: data.receipt,
    expiresAt: str(data.expiresAt),
    readAt: str(data.readAt),
    readAcknowledgedAt:
      typeof data.readAcknowledgedAt === 'string'
        ? data.readAcknowledgedAt
        : null,
  }
}

export type ReadCrossingsResult =
  | { status: 'ok'; crossings: CrossingForDisposition[] }
  | { status: 'error'; reason: string }

/** One task-scoped read of the LUM-435 view (every crossing on the task).
 *  Fails closed: transport / non-ok / unparseable → error, never "none". */
export async function readCrossings(
  base: string,
  headers: Record<string, string>,
  taskId: string
): Promise<ReadCrossingsResult> {
  let res: Response
  try {
    res = await fetch(
      `${base}/api/tasks/${encodeURIComponent(taskId)}/boundary-crossings`,
      { headers }
    )
  } catch (err) {
    return {
      status: 'error',
      reason: err instanceof Error ? err.message : 'network error',
    }
  }
  if (res.status === 401) {
    return { status: 'error', reason: 'API key invalid or revoked' }
  }
  if (!res.ok) return { status: 'error', reason: `HTTP ${res.status}` }
  let data: { crossings?: CrossingForDisposition[] }
  try {
    data = (await res.json()) as { crossings?: CrossingForDisposition[] }
  } catch {
    return { status: 'error', reason: 'invalid response body' }
  }
  return {
    status: 'ok',
    crossings: Array.isArray(data.crossings) ? data.crossings : [],
  }
}

/** LUM-1059: what to show for a crossing — its ref, else the cuid. */
export function crossingLabel(c: {
  id: string
  ref?: string | undefined
}): string {
  return c.ref || c.id
}

/** LUM-1059: whether a user-typed id names this crossing — the cuid, or the
 *  ref in any case (`lum-x12` = `LUM-X12`). */
export function crossingMatches(
  c: { id: string; ref?: string | undefined },
  typed: string
): boolean {
  const key = typed.trim()
  return c.id === key || (!!c.ref && c.ref.toUpperCase() === key.toUpperCase())
}

/** LUM-1059: this crossing's token in a receipt map keyed by ref or cuid
 *  (an envelope from before refs keys by cuid). */
export function receiptFor(
  receipts: Map<string, string>,
  c: { id: string; ref?: string | undefined }
): string | undefined {
  for (const [key, token] of receipts) {
    if (crossingMatches(c, key)) return token
  }
  return undefined
}

/**
 * A batch carries one receipt per crossing in a single `--receipt` value
 * (LUM-845): `<id>=<token>,<id>=<token>`. Tokens are `r1.`/`r2.` + digits and
 * a base64url signature, crossing ids are refs (`LUM-X12`) or cuids — none contains `=` or
 * `,`, so the pair list needs no quoting and survives `shellQuote` bare.
 */
export function formatReceiptMap(receipts: Map<string, string>): string {
  return [...receipts].map(([id, token]) => `${id}=${token}`).join(',')
}

/** Parse `<id>=<token>,…`; null when any pair is malformed or an id repeats. */
export function parseReceiptMap(value: string): Map<string, string> | null {
  const out = new Map<string, string>()
  for (const pair of value.split(',')) {
    const eq = pair.indexOf('=')
    if (eq <= 0 || eq === pair.length - 1) return null
    const id = pair.slice(0, eq).trim()
    const token = pair.slice(eq + 1).trim()
    if (!id || !token || out.has(id)) return null
    out.set(id, token)
  }
  return out
}

/** A receipt value in batch form (`<id>=<token>`) rather than a bare token. */
export function isReceiptMap(value: string): boolean {
  return value.includes('=')
}
