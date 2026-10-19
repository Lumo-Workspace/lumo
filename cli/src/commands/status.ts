import { EXIT_USAGE } from '../lib/exit-codes'
import { fmtDay } from '../lib/format'
import { emitJson, stripInternalFields, withVersion } from '../lib/json-output'
import { sectionHeading } from '../lib/report-layout'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext, type ApiContext } from '../lib/test-case-api'
import { colorEnabled } from '../lib/ui'
import { formatDraftList, type DraftRow } from './draft-list'
import {
  formatInbox,
  inboxView,
  type InboxFilter,
  type InboxResponse,
} from './inbox-list'
import {
  formatNextResult,
  loadNext,
  nextResultJson,
  parseNextLimit,
  type NextResult,
} from './next'
import type { ListResponse, PriorityView } from './priority'

/**
 * `lumo status` (LUM-1233 3f, Q1) — me across the workspace in one call:
 * the team's current priority, then my Inbox, Drafts and Next tasks. It
 * replaces `inbox list`, `draft list` and `next`; `--inbox`, `--drafts`,
 * `--next` print only those sections (one flag = exactly the old command's
 * output and `--json` envelope). Read-only; never takes a task ref.
 * The Inbox shows unread notifications only unless `--all` (LUM-1233).
 */
export interface StatusOptions {
  inbox?: boolean | undefined
  /** Inbox: read notifications too (default: unread only). */
  all?: boolean | undefined
  drafts?: boolean | undefined
  next?: boolean | undefined
  claimable?: boolean | undefined
  limit?: string | undefined
  json?: boolean | undefined
}

type Section = 'inbox' | 'drafts' | 'next'
const SECTIONS: readonly Section[] = ['inbox', 'drafts', 'next']
const TITLE: Record<Section, string> = {
  inbox: 'Inbox',
  drafts: 'Drafts',
  next: 'Next',
}

/** The sections to print: the flagged ones, or all of them. Pure. */
export function statusSections(o: StatusOptions): Section[] {
  const picked = SECTIONS.filter(s => o[s] === true)
  return picked.length > 0 ? picked : [...SECTIONS]
}

/** Usage problems of a flag combination (null = fine). Pure. */
export function statusUsageError(o: StatusOptions): string | null {
  const sections = statusSections(o)
  if (!sections.includes('inbox') && o.all !== undefined)
    return '--all goes with --inbox'
  if (!sections.includes('next'))
    for (const [flag, v] of [
      ['--claimable', o.claimable],
      ['--limit', o.limit],
    ] as const)
      if (v !== undefined) return `${flag} goes with --next`
  if (parseNextLimit(o.limit) === null)
    return `invalid --limit "${o.limit}" (expected a positive integer)`
  return null
}

/** The one-line priority summary of the full view. Pure. */
export function formatPriorityLine(current: PriorityView | null): string {
  if (!current) return 'Priority: none declared'
  const text = sanitizeField(current.statement).replace(/\s+/g, ' ').trim()
  return `Priority: ${text} (since ${fmtDay(current.effectiveFrom)})`
}

/** The Inbox filter a flag set asks for. Pure. */
export function inboxFilter(o: StatusOptions): InboxFilter {
  return o.all === true ? 'all' : 'unread'
}

/** The notifications path: `unread=1` unless `--all`. Pure. */
export function inboxPath(filter: InboxFilter): string {
  return filter === 'all' ? '/api/notifications' : '/api/notifications?unread=1'
}

interface Loaded {
  priority?: PriorityView | null
  inbox?: InboxResponse
  drafts?: DraftRow[]
  next?: NextResult
  failed: boolean
}

async function load(
  ctx: ApiContext,
  sections: Section[],
  o: StatusOptions,
  withPriority: boolean
): Promise<Loaded | number> {
  const want = (s: Section) => sections.includes(s)
  const [priority, inbox, drafts, next] = await Promise.all([
    withPriority
      ? apiCall<ListResponse>(ctx, '/api/priorities', {}, 'priority')
      : null,
    want('inbox')
      ? apiCall<InboxResponse>(ctx, inboxPath(inboxFilter(o)), {}, 'inbox')
      : null,
    want('drafts')
      ? apiCall<{ drafts: DraftRow[] }>(ctx, '/api/drafts', {}, 'drafts')
      : null,
    want('next') ? loadNext({ limit: o.limit, claimable: o.claimable }) : null,
  ])
  // A usage error from Next is the whole command's answer.
  if (next === EXIT_USAGE) return EXIT_USAGE
  const out: Loaded = { failed: false }
  const miss = () => {
    out.failed = true
  }
  if (priority) {
    if (priority.ok && priority.data) out.priority = priority.data.current
    else miss()
  }
  if (inbox) {
    if (inbox.ok && inbox.data) out.inbox = inbox.data
    else miss()
  }
  if (drafts) {
    if (drafts.ok && drafts.data) out.drafts = drafts.data.drafts
    else miss()
  }
  if (next !== null) {
    if (typeof next === 'number') miss()
    else out.next = next
  }
  return out
}

/**
 * The inbox envelope: the server payload (unread rows only by default),
 * `total` / `nextCursor` (J-2) and `filter` (LUM-1233, additive).
 */
function inboxJson(raw: InboxResponse, filter: InboxFilter) {
  const { data, total } = inboxView(raw, filter)
  return withVersion({ ...data, total, nextCursor: null, filter })
}
const draftsJson = (d: DraftRow[]) =>
  withVersion({ drafts: d, total: d.length, nextCursor: null })

/** Drop the per-section `version`; the combined envelope carries one. */
function bare(env: Record<string, unknown>): Record<string, unknown> {
  const { version: _v, ...rest } = env
  return rest
}

export async function status(o: StatusOptions = {}): Promise<number | void> {
  const error = statusUsageError(o)
  if (error) {
    console.error(`Error: ${error}`)
    return EXIT_USAGE
  }
  const ctx = apiContext()
  if (!ctx) return 1
  const sections = statusSections(o)
  const single = sections.length === 1 && o[sections[0]!] === true
  const full = SECTIONS.every(s => o[s] !== true)
  const r = await load(ctx, sections, o, full)
  if (typeof r === 'number') return r
  const filter = inboxFilter(o)

  if (o.json) {
    if (single) {
      const s = sections[0]!
      if (s === 'inbox' && r.inbox) emitJson(inboxJson(r.inbox, filter))
      if (s === 'drafts' && r.drafts) emitJson(draftsJson(r.drafts))
      if (s === 'next' && r.next) emitJson(nextResultJson(r.next))
      return r.failed ? 1 : undefined
    }
    // Every requested key is present; a section whose request failed is
    // null (its error went to stderr and the exit code is 1).
    const env: Record<string, unknown> = {}
    if (full) env.priority = stripInternalFields(r.priority ?? null)
    if (sections.includes('inbox'))
      env.inbox = r.inbox ? bare(inboxJson(r.inbox, filter)) : null
    if (sections.includes('drafts'))
      env.drafts = r.drafts ? bare(draftsJson(r.drafts)) : null
    if (sections.includes('next'))
      env.next = r.next ? bare(nextResultJson(r.next)) : null
    emitJson(withVersion(env))
    return r.failed ? 1 : undefined
  }

  const color = colorEnabled()
  const lines: string[] = []
  if (full && r.priority !== undefined)
    lines.push(formatPriorityLine(r.priority))
  for (const s of sections) {
    let body: string | null = null
    if (s === 'inbox' && r.inbox)
      body = formatInbox(inboxView(r.inbox, filter).data, { color }, filter)
    if (s === 'drafts' && r.drafts) body = formatDraftList(r.drafts)
    if (s === 'next' && r.next) body = formatNextResult(r.next)
    if (body === null) continue
    if (single) lines.push(body)
    else {
      const heading = sectionHeading(TITLE[s], { color })
      lines.push(...(lines.length === 0 ? heading.slice(1) : heading), body)
    }
  }
  if (lines.length > 0) process.stdout.write(lines.join('\n') + '\n')
  return r.failed ? 1 : undefined
}
