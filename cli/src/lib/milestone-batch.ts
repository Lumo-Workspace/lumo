import { sanitizeField } from './sanitize'

/**
 * Shared pure helpers for the batch `milestone add` / `milestone remove`
 * commands. Kept free of network/IO so they can be unit-tested directly.
 */

export type BatchStatus = 'ok' | 'skip' | 'fail'

export interface BatchOutcome {
  task: string
  status: BatchStatus
  detail?: string
}

/**
 * Trim, drop empties, and dedupe task refs case-insensitively while
 * preserving input order and the first original spelling of each ref.
 */
export function dedupeTaskRefs(refs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of refs) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

interface MilestoneTaskRow {
  id: string
  number: number
  teamIdentifier: string
}

/**
 * Split requested task refs into those currently bound to the milestone
 * (`present`) and those that are not (`absent`). A ref matches either the
 * `<teamIdentifier>-<number>` identifier (case-insensitive) or the task id.
 */
export function partitionMembership(
  requested: string[],
  milestoneTasks: MilestoneTaskRow[]
): { present: string[]; absent: string[] } {
  const keys = new Set<string>()
  for (const t of milestoneTasks) {
    keys.add(`${t.teamIdentifier}-${t.number}`.toUpperCase())
    keys.add(t.id.toLowerCase())
  }
  const present: string[] = []
  const absent: string[] = []
  for (const ref of requested) {
    const isMember = keys.has(ref.toUpperCase()) || keys.has(ref.toLowerCase())
    if (isMember) present.push(ref)
    else absent.push(ref)
  }
  return { present, absent }
}

const STATUS_GLYPH: Record<BatchStatus, string> = {
  ok: '✓',
  skip: '-',
  fail: '✗',
}

/**
 * Render the batch result: a one-line tally header (omitting zero
 * categories) followed by one line per task. Server-derived text (milestone
 * name, failure detail) is sanitized to block ANSI injection.
 */
export function formatBatchSummary(args: {
  milestoneName: string
  /** Past-tense action word for the tally header, e.g. "added", "removed",
   *  "marked claimable" (LUM-646 triage). */
  verb: 'added' | 'removed' | 'marked claimable' | 'marked not-claimable'
  outcomes: BatchOutcome[]
}): string {
  const { verb, outcomes } = args
  const name = sanitizeField(args.milestoneName)

  const okCount = outcomes.filter(o => o.status === 'ok').length
  const skipCount = outcomes.filter(o => o.status === 'skip').length
  const failCount = outcomes.filter(o => o.status === 'fail').length

  const parts: string[] = [`${okCount} ${verb}`]
  if (skipCount > 0) parts.push(`${skipCount} skipped`)
  if (failCount > 0) parts.push(`${failCount} failed`)

  const lines = [`${name}: ${parts.join(', ')}`]
  for (const o of outcomes) {
    const glyph = STATUS_GLYPH[o.status]
    const detail = o.detail ? `  ${sanitizeField(o.detail)}` : ''
    lines.push(`  ${glyph} ${o.task}${detail}`)
  }
  return lines.join('\n')
}
