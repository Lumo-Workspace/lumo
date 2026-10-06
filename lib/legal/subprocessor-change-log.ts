/**
 * LUM-919: pure logic over the subprocessor change log
 * (`lib/legal/subprocessor-changes.ts`) — the guard that holds the registry
 * to the log, the /security view of what is in use / upcoming / recent, and
 * the send script's notice-period check. No I/O, no clock: callers pass `now`.
 */
import type {
  AiHostSubprocessor,
  InfrastructureSubprocessor,
} from '@/lib/legal/subprocessors'
import {
  NOTICE_PERIOD_DAYS,
  RECENT_CHANGE_DAYS,
  type SubprocessorChange,
  type SubprocessorRef,
} from '@/lib/legal/subprocessor-changes'

const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const CHANGE_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/

/** `infrastructure:<id>` / `aiHost:<gatewaySlug>` — one key per registry entry. */
export function subprocessorSubject(ref: SubprocessorRef): string {
  return ref.list === 'infrastructure'
    ? `infrastructure:${ref.entry.id}`
    : `aiHost:${ref.entry.gatewaySlug}`
}

/** The facts the guard compares: entity, service, product, location, region. */
export function subprocessorFingerprint(ref: SubprocessorRef): string {
  const parts =
    ref.list === 'infrastructure'
      ? [
          ref.entry.entity,
          ref.entry.docService,
          ref.entry.product,
          ref.entry.location,
          ref.entry.region,
        ]
      : [ref.entry.entity, ref.entry.location]
  return parts.filter((p): p is string => Boolean(p)).join(' | ')
}

/** 00:00 UTC of a `YYYY-MM-DD` day, in ms (NaN when malformed). */
export function utcDayStart(day: string): number {
  return ISO_DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : NaN
}

/** Whole days from announcement to effect. */
export function noticeDays(change: SubprocessorChange): number {
  return (
    (utcDayStart(change.effectiveAt) - utcDayStart(change.announcedAt)) / DAY_MS
  )
}

export function isUrgent(change: SubprocessorChange): boolean {
  return Boolean(change.urgent?.reason.trim())
}

/** Not yet in effect at `now`. */
export function isPending(change: SubprocessorChange, now: Date): boolean {
  return now.getTime() < utcDayStart(change.effectiveAt)
}

function shapeProblem(c: SubprocessorChange): string | null {
  const has = { before: Boolean(c.before), after: Boolean(c.after) }
  switch (c.kind) {
    case 'added':
      return has.after && !has.before ? null : 'needs `after` only'
    case 'removed':
      return has.before && !has.after ? null : 'needs `before` only'
    case 'replaced':
      if (!has.before || !has.after) return 'needs `before` and `after`'
      return subprocessorSubject(c.before!) === subprocessorSubject(c.after!)
        ? 'replaces an entry with itself (use `changed`)'
        : null
    case 'changed':
      if (!has.before || !has.after) return 'needs `before` and `after`'
      return subprocessorSubject(c.before!) === subprocessorSubject(c.after!)
        ? null
        : 'changes two different entries (use `replaced`)'
  }
}

/** Per-change rules that need no replay: id, dates, shape, notice period. */
function changeProblems(c: SubprocessorChange): string[] {
  const out: string[] = []
  if (!CHANGE_ID.test(c.id)) out.push(`${c.id}: id is not YYYY-MM-DD-<slug>`)
  if (Number.isNaN(utcDayStart(c.announcedAt)))
    out.push(`${c.id}: announcedAt is not YYYY-MM-DD`)
  if (Number.isNaN(utcDayStart(c.effectiveAt)))
    out.push(`${c.id}: effectiveAt is not YYYY-MM-DD`)
  if (!c.summary.trim()) out.push(`${c.id}: summary is empty`)
  if (c.urgent && !c.urgent.reason.trim())
    out.push(`${c.id}: urgent without a reason`)
  const shape = shapeProblem(c)
  if (shape) out.push(`${c.id}: ${c.kind} ${shape}`)
  const days = noticeDays(c)
  if (days < 0) out.push(`${c.id}: takes effect before it is announced`)
  else if (c.kind !== 'removed' && !isUrgent(c) && days < NOTICE_PERIOD_DAYS)
    out.push(
      `${c.id}: ${days} days of notice, DPA 7.2 needs ${NOTICE_PERIOD_DAYS} (or mark it urgent with a reason)`
    )
  return out
}

export interface ChangeLogInput {
  baseline: Readonly<Record<string, string>>
  changes: readonly SubprocessorChange[]
  infrastructure: readonly InfrastructureSubprocessor[]
  aiHosts: readonly AiHostSubprocessor[]
}

function registryRefs(
  input: Pick<ChangeLogInput, 'infrastructure' | 'aiHosts'>
): SubprocessorRef[] {
  return [
    ...input.infrastructure.map(
      entry => ({ list: 'infrastructure', entry }) as const
    ),
    ...input.aiHosts.map(entry => ({ list: 'aiHost', entry }) as const),
  ]
}

/**
 * Every way the registry and the change log disagree; empty = in step.
 * Replays the log over the baseline (each `before` must match the state it
 * replaces) and compares the result with the registry entry by entry, so an
 * entry added, changed or removed without a record is named.
 */
export function checkSubprocessorChangeLog(input: ChangeLogInput): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  let previous = ''
  for (const c of input.changes) {
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`)
    ids.add(c.id)
    if (c.announcedAt < previous)
      problems.push(`${c.id}: out of order (the log is oldest first)`)
    previous = c.announcedAt
    problems.push(...changeProblems(c))
  }

  const state = new Map(Object.entries(input.baseline))
  for (const c of input.changes) {
    if (c.before) {
      const subject = subprocessorSubject(c.before)
      if (state.get(subject) !== subprocessorFingerprint(c.before))
        problems.push(`${c.id}: \`before\` does not match ${subject} as logged`)
      state.delete(subject)
    }
    if (c.after)
      state.set(subprocessorSubject(c.after), subprocessorFingerprint(c.after))
  }

  const registry = new Map(
    registryRefs(input).map(r => [
      subprocessorSubject(r),
      subprocessorFingerprint(r),
    ])
  )
  for (const [subject, fingerprint] of registry) {
    const logged = state.get(subject)
    if (logged === undefined)
      problems.push(`${subject}: in the registry with no \`added\` record`)
    else if (logged !== fingerprint)
      problems.push(
        `${subject}: registry differs from the change log (record a \`changed\`): ${fingerprint} vs ${logged}`
      )
  }
  for (const subject of state.keys())
    if (!registry.has(subject))
      problems.push(
        `${subject}: gone from the registry with no \`removed\` record`
      )
  return problems
}

export interface SubprocessorPageView {
  /** What is in use at `now` — pending additions hidden, pending removals kept. */
  infrastructure: InfrastructureSubprocessor[]
  aiHosts: AiHostSubprocessor[]
  /** Announced, not yet in effect; soonest first. */
  pending: SubprocessorChange[]
  /** In effect within RECENT_CHANGE_DAYS; newest first. */
  recent: SubprocessorChange[]
}

/**
 * /security's subprocessor section at `now`. The registry already holds the
 * announced state, so for every pending change the in-use lists drop its
 * `after` entry and put back its `before` entry: a new subprocessor shows as
 * upcoming only, and a moved one keeps its current location until the day.
 */
export function buildSubprocessorPageView(input: {
  infrastructure: readonly InfrastructureSubprocessor[]
  aiHosts: readonly AiHostSubprocessor[]
  changes: readonly SubprocessorChange[]
  now: Date
}): SubprocessorPageView {
  const pending = input.changes
    .filter(c => isPending(c, input.now))
    .sort((a, b) => a.effectiveAt.localeCompare(b.effectiveAt))
  const recentFrom = input.now.getTime() - RECENT_CHANGE_DAYS * DAY_MS
  const recent = input.changes
    .filter(
      c => !isPending(c, input.now) && utcDayStart(c.effectiveAt) >= recentFrom
    )
    .sort((a, b) => b.effectiveAt.localeCompare(a.effectiveAt))

  // Undo pending changes in reverse log order (the order they were applied
  // to the registry), so two pending changes to one entry unwind to the state
  // in effect today. A restored entry takes the place of the one it undoes,
  // so the tables keep their order.
  const inUse: SubprocessorRef[] = registryRefs(input)
  const pendingIds = new Set(pending.map(c => c.id))
  const inLogOrder = input.changes.filter(c => pendingIds.has(c.id))
  for (const c of [...inLogOrder].reverse()) {
    const at = c.after
      ? inUse.findIndex(
          r => subprocessorSubject(r) === subprocessorSubject(c.after!)
        )
      : -1
    if (at >= 0) inUse.splice(at, 1)
    const before = c.before
    if (
      before &&
      !inUse.some(r => subprocessorSubject(r) === subprocessorSubject(before))
    )
      inUse.splice(at >= 0 ? at : inUse.length, 0, before)
  }
  return {
    infrastructure: inUse.flatMap(r =>
      r.list === 'infrastructure' ? [r.entry] : []
    ),
    aiHosts: inUse.flatMap(r => (r.list === 'aiHost' ? [r.entry] : [])),
    pending,
    recent,
  }
}

/**
 * Why the send script must not email this change now, or null. A removal is
 * not announced; anything else needs NOTICE_PERIOD_DAYS between `now` and the
 * day it takes effect, unless it is urgent (then it goes out as soon as
 * possible, even after the fact).
 */
export function noticeRefusal(
  change: SubprocessorChange,
  now: Date
): string | null {
  if (change.kind === 'removed')
    return `${change.id} is a removal; removals are recorded, not announced`
  if (isUrgent(change)) return null
  const daysLeft = (utcDayStart(change.effectiveAt) - now.getTime()) / DAY_MS
  if (daysLeft < NOTICE_PERIOD_DAYS)
    return `${change.id} takes effect ${change.effectiveAt}, ${Math.max(0, Math.floor(daysLeft))} days from now; DPA 7.2 needs ${NOTICE_PERIOD_DAYS} days of notice. Move effectiveAt, or mark the change urgent with a reason.`
  return null
}
