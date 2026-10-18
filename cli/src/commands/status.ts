import { EXIT_USAGE } from '../lib/exit-codes'
import { fmtDay } from '../lib/format'
import { emitJson, stripInternalFields, withVersion } from '../lib/json-output'
import { sectionHeading } from '../lib/report-layout'
import { sanitizeField } from '../lib/sanitize'
import { apiCall, apiContext, type ApiContext } from '../lib/test-case-api'
import { colorEnabled } from '../lib/ui'
import { formatDraftList, type DraftRow } from './draft-list'
import { formatInbox, inboxPage, type InboxResponse } from './inbox-list'
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
 */
export interface StatusOptions {
  inbox?: boolean | undefined
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
      ? apiCall<InboxResponse>(ctx, '/api/notifications', {}, 'inbox')
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

const inboxJson = (d: InboxResponse) => withVersion({ ...d, ...inboxPage(d) })
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

  if (o.json) {
    if (single) {
      const s = sections[0]!
      if (s === 'inbox' && r.inbox) emitJson(inboxJson(r.inbox))
      if (s === 'drafts' && r.drafts) emitJson(draftsJson(r.drafts))
      if (s === 'next' && r.next) emitJson(nextResultJson(r.next))
      return r.failed ? 1 : undefined
    }
    // Every requested key is present; a section whose request failed is
    // null (its error went to stderr and the exit code is 1).
    const env: Record<string, unknown> = {}
    if (full) env.priority = stripInternalFields(r.priority ?? null)
    if (sections.includes('inbox'))
      env.inbox = r.inbox ? bare(inboxJson(r.inbox)) : null
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
    if (s === 'inbox' && r.inbox) body = formatInbox(r.inbox, { color })
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
