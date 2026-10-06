import { redactForStorage } from '@/lib/security-scan/scan-secrets'
import { redactJsonForStorage } from '@/lib/validation/hook-payload'

/**
 * LUM-898 — the free-text / JSON columns of tables that used to be written
 * with no credential redaction at all (for BoundaryCrossing and TestCaseRun,
 * only their human/agent-written note columns, plus the crossing's
 * command-quoting `detail` / `target`). Their repositories pass every write's
 * `data` through `redactStoredFields` with the table's list, so a credential
 * pasted into a comment, a memory card, an artifact, a crossing explanation,
 * a task field or an activity payload is stored in the `AKIA…(len 20)` form
 * HookEvent payloads already get (LUM-859). The stock backfill
 * (scripts/backfill-secret-stock-reredact.ts) covers rows stored before this.
 */
export const STORAGE_REDACTED_FIELDS = {
  comment: ['body'],
  memory: ['content'],
  taskArtifact: ['title', 'content', 'summary'],
  boundaryCrossingExplanation: ['note'],
  taskActivity: ['payload'],
  // Column-scoped: the other stock-scanned columns of these two tables are
  // written by detectors / the run recorder, not free text (LUM-898 follow-up)
  // — except `detail` / `target`, which quote the raw command (LUM-900), and
  // the LLM-written `systemExplanation` (LUM-904).
  boundaryCrossing: [
    'detail',
    'target',
    'dispositionNote',
    'systemExplanation',
  ],
  testCaseRun: ['note', 'actual'],
  task: [
    'title',
    'description',
    'spec',
    'claimSnapshot',
    'commentsSummary',
    'agentError',
  ],
} as const satisfies Record<string, readonly string[]>

function isPlainJson(value: unknown): boolean {
  if (Array.isArray(value)) return true
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactForStorage(value).text
  // Prisma sentinels (DbNull / JsonNull) are class instances — left alone.
  if (!isPlainJson(value)) return value
  return redactJsonForStorage(value).value
}

/**
 * `data` with every listed field redacted — a plain value or a Prisma
 * `{ set: … }` update. Returns the same object when nothing matched, so a
 * clean write reaches Prisma exactly as the caller built it.
 */
export function redactStoredFields<T extends object>(
  data: T,
  fields: readonly string[]
): T {
  let next: Record<string, unknown> | null = null
  const source = data as Record<string, unknown>
  for (const field of fields) {
    if (!(field in source)) continue
    const value = source[field]
    // A Prisma `{ set: … }` update is a plain object: the deep pass reaches it.
    const redacted = redactValue(value)
    if (redacted === value) continue
    next ??= { ...source }
    next[field] = redacted
  }
  return (next ?? data) as T
}
