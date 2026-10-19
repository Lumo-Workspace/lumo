import { readFileSync, statSync } from 'fs'
import { basename, extname } from 'path'
import { readCredentials } from '../lib/config'
import { resolveAuthedApiUrl, trimTrailingSlash } from '../lib/api'
import { readCliVersion } from '../lib/cli-version'
import { errAuth, errNotLoggedIn, httpFailed } from '../lib/errors'
import { cmd, hint, note, successLine } from '../lib/feedback'
import {
  collectFeedbackEnv,
  formatEnvSummary,
  type FeedbackEnv,
} from '../lib/feedback-env'
import { emptyState, fmtEnum, fmtInstant, NONE } from '../lib/format'
import { detailEnvelope, emitJson, listEnvelope } from '../lib/json-output'
import { readLastCommand } from '../lib/last-command'
import { renderListTable, type ListRenderOptions } from '../lib/list-table'
import { nextStepsSilenced } from '../lib/next-steps'
import { NEXT_PAGE_PREFIX, buildCommand } from '../lib/pagination'
import { indentLines, sectionHeading } from '../lib/report-layout'
import { sanitizeField } from '../lib/sanitize'
import { resolveSessionId } from '../lib/session-id'
import { kvBlock } from '../lib/ui'

/**
 * LUM-1240 — `lumo feedback create | list | show`: report a Lumo bug, idea or
 * question to the Lumo team, and read the status and replies of the reports
 * this workspace sent. An agent may file without asking (no confirmation
 * envelope, user ruling 2026-10-19). Design:
 * docs/rfc/2026-10-19-LUM-1240-feedback.md.
 */

export const FEEDBACK_KINDS = ['bug', 'idea', 'question'] as const
export const FEEDBACK_STATUSES = [
  'new',
  'triaged',
  'resolved',
  'wontfix',
] as const

/** Mirrors lib/validation/feedback.ts (the server enforces the same). */
export const MAX_TITLE = 200
export const MAX_STEPS = 30
export const MAX_STEP = 500
export const MAX_TEXT = 2000
export const MAX_FILES = 5
/** 4 MB: each file goes up in its own request, under the ~4.5 MB body limit. */
export const MAX_FILE_BYTES = 4 * 1024 * 1024

export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.json': 'application/json',
}

const EXIT_ERROR = 1
const EXIT_USAGE = 2

interface Ctx {
  base: string
  token: string
  workspaceSlug: string
}

function context(): Ctx | null {
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return null
  }
  return {
    base: trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl)),
    token: creds.token,
    workspaceSlug: creds.workspaceSlug,
  }
}

function oneCell(text: string): string {
  return sanitizeField(text).replace(/[\t\r\n\v\f]/g, ' ')
}

// ── shapes the server sends ─────────────────────────────────────────────

export interface FeedbackEvidence {
  url: string
  filename: string
  contentType: string
  size: number
}

export interface FeedbackDetail {
  ref: string
  id: string
  kind: string
  status: string
  title: string
  steps: string[]
  expected: string | null
  actual: string | null
  evidence: FeedbackEvidence[]
  environment: FeedbackEnv | null
  task: string | null
  sessionId: string | null
  submittedBy: { name: string } | null
  secretsRedacted: number
  createdAt: string
  updatedAt: string
  statusChangedAt: string | null
}

export interface FeedbackReply {
  body: string
  author: string
  createdAt: string
}

export interface FeedbackListItem {
  ref: string
  id: string
  kind: string
  status: string
  title: string
  replyCount: number
  submittedBy: { name: string } | null
  createdAt: string
}

interface DetailResponse {
  feedback: FeedbackDetail
  replies: FeedbackReply[]
}

interface ListResponse {
  feedback: FeedbackListItem[]
  total: number
  nextCursor: string | null
}

interface ErrorBody {
  error?: string
  code?: string
  scope?: string
  window?: string
  retryAt?: string
}

// ── create ──────────────────────────────────────────────────────────────

export interface FeedbackCreateOptions {
  title: string
  kind?: string
  step?: string[]
  expected?: string
  actual?: string
  evidenceFile?: string[]
  task?: string
  /** Commander: `--no-env` → false. */
  env?: boolean
  json?: boolean
}

/** Local checks that need no network (exit 2). Returns the error text or null. */
export function validateCreateOptions(o: FeedbackCreateOptions): string | null {
  const kind = (o.kind ?? 'bug').toLowerCase()
  if (!(FEEDBACK_KINDS as readonly string[]).includes(kind))
    return `invalid --kind "${o.kind}" (allowed: ${FEEDBACK_KINDS.join(', ')})`
  if (!o.title.trim()) return '--title must not be empty'
  if (o.title.length > MAX_TITLE)
    return `--title is longer than ${MAX_TITLE} characters`
  const steps = o.step ?? []
  if (steps.length > MAX_STEPS) return `at most ${MAX_STEPS} --step values`
  if (steps.some(s => !s.trim() || s.length > MAX_STEP))
    return `each --step must be 1-${MAX_STEP} characters`
  for (const [flag, v] of [
    ['--expected', o.expected],
    ['--actual', o.actual],
  ] as const) {
    if (v !== undefined && (!v.trim() || v.length > MAX_TEXT))
      return `${flag} must be 1-${MAX_TEXT} characters`
  }
  if (o.task !== undefined && !/^[A-Za-z]{1,10}-\d{1,9}$/.test(o.task.trim()))
    return `invalid --task "${o.task}" (expected a task ref such as LUM-42)`
  const files = o.evidenceFile ?? []
  if (files.length > MAX_FILES)
    return `at most ${MAX_FILES} --evidence-file values (got ${files.length})`
  for (const f of files) {
    if (!MIME_BY_EXT[extname(f).toLowerCase()])
      return `unsupported evidence file "${f}" (allowed: ${Object.keys(MIME_BY_EXT).join(' ')})`
  }
  return null
}

/** The JSON `payload` part. */
export function buildPayload(
  o: FeedbackCreateOptions,
  environment: FeedbackEnv | null
): Record<string, unknown> {
  return {
    title: o.title.trim(),
    kind: (o.kind ?? 'bug').toUpperCase(),
    steps: (o.step ?? []).map(s => s.trim()),
    ...(o.expected !== undefined ? { expected: o.expected.trim() } : {}),
    ...(o.actual !== undefined ? { actual: o.actual.trim() } : {}),
    ...(o.task !== undefined ? { task: o.task.trim().toUpperCase() } : {}),
    // --no-env: the key is left out entirely.
    ...(environment ? { environment } : {}),
  }
}

/** The error lines for a refused submission (stderr). */
export function createErrorLines(
  status: number,
  body: ErrorBody | null
): string[] {
  if (status === 429 && body?.code === 'RATE_LIMITED') {
    const when = body.retryAt ? fmtInstant(body.retryAt, { tty: true }) : null
    return [
      `Error: ${body.error ?? 'feedback limit reached'}${when ? `; you can send more after ${when}` : ''}`,
      hint(
        `add details to an existing report instead (${cmd('lumo feedback list --mine')}); if this is urgent, tell the Lumo team directly.`
      ),
    ]
  }
  if (status === 413)
    return [
      'Error: evidence too large for one request (HTTP 413)',
      hint(
        'attach fewer or smaller files, e.g. crop the screenshot or trim the log.'
      ),
    ]
  return [`Error: ${body?.error ?? httpFailed('feedback create', status)}`]
}

/** The success block (stdout). */
export function formatCreated(
  f: FeedbackDetail,
  sentEnv: FeedbackEnv | null,
  opts: { hints: boolean }
): string {
  const lines = [
    successLine({
      verb: 'Created',
      kind: 'feedback',
      ref: f.ref,
      title: f.title,
    }),
    kvBlock(
      [
        ['Kind', fmtEnum(f.kind)],
        ['Status', fmtEnum(f.status)],
        [
          'Evidence',
          f.evidence.length === 0
            ? NONE
            : `${f.evidence.length} file${f.evidence.length === 1 ? '' : 's'}`,
        ],
        ['Task', f.task ?? NONE],
        ['Sent env', formatEnvSummary(sentEnv)],
      ],
      { color: false }
    ),
  ]
  if (f.secretsRedacted > 0)
    lines.push(
      note(
        `${f.secretsRedacted} suspected secret${f.secretsRedacted === 1 ? ' was' : 's were'} redacted before saving.`
      )
    )
  if (opts.hints)
    lines.push(
      hint(
        `the Lumo team's replies show up in ${cmd(`lumo feedback show ${f.ref}`)}.`
      )
    )
  return lines.join('\n')
}

export async function feedbackCreate(
  o: FeedbackCreateOptions
): Promise<number | void> {
  const invalid = validateCreateOptions(o)
  if (invalid) {
    console.error(`Error: ${invalid}`)
    return EXIT_USAGE
  }

  const files: Array<{ path: string; bytes: Buffer; type: string }> = []
  for (const p of o.evidenceFile ?? []) {
    let size: number
    try {
      size = statSync(p).size
    } catch {
      console.error(`Error: cannot read evidence file "${p}".`)
      return EXIT_ERROR
    }
    if (size > MAX_FILE_BYTES) {
      console.error(`Error: evidence file "${p}" is larger than 4 MB`)
      return EXIT_USAGE
    }
    let bytes: Buffer
    try {
      bytes = readFileSync(p)
    } catch {
      console.error(`Error: cannot read evidence file "${p}".`)
      return EXIT_ERROR
    }
    files.push({ path: p, bytes, type: MIME_BY_EXT[extname(p).toLowerCase()]! })
  }

  const ctx = context()
  if (!ctx) return EXIT_ERROR

  const sendEnv = o.env !== false
  const environment = sendEnv
    ? collectFeedbackEnv({
        cliVersion: readCliVersion(),
        lastCommand: readLastCommand(),
      })
    : null

  const headers: Record<string, string> = {
    Authorization: `Bearer ${ctx.token}`,
  }
  if (sendEnv) {
    // The session id is a ref only; --no-env leaves it out too.
    const sessionId = await resolveSessionId({ write: false }).catch(
      () => undefined
    )
    if (sessionId) headers['X-Lumo-Session-Id'] = sessionId
  }

  // The report first, then each file in its own request: one request per
  // file stays under the platform's ~4.5 MB request-body limit.
  const fd = new FormData()
  fd.append('payload', JSON.stringify(buildPayload(o, environment)))

  let res: Response
  try {
    res = await fetch(`${ctx.base}/api/feedback`, {
      method: 'POST',
      headers,
      body: fd,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${ctx.base} (${msg})`)
    return EXIT_ERROR
  }
  if (res.status === 401) {
    console.error(errAuth())
    return EXIT_ERROR
  }
  const body = (await res.json().catch(() => null)) as
    | (DetailResponse & ErrorBody)
    | null
  if (!res.ok || !body?.feedback) {
    for (const line of createErrorLines(res.status, body)) console.error(line)
    return EXIT_ERROR
  }

  let latest: DetailResponse = body
  const failed: string[] = []
  for (const f of files) {
    const up = await uploadEvidence(ctx, body.feedback.ref, f)
    if (up.ok) latest = up.data
    else failed.push(`${basename(f.path)} (${up.error})`)
  }

  if (o.json) {
    emitJson(
      detailEnvelope('feedback', latest.feedback, { replies: latest.replies })
    )
  } else {
    console.log(
      formatCreated(latest.feedback, environment, {
        hints: !nextStepsSilenced() && failed.length === 0,
      })
    )
  }
  if (failed.length > 0) {
    console.error(
      `Error: feedback ${body.feedback.ref} was sent, but ${failed.length} evidence file${failed.length === 1 ? '' : 's'} could not be attached: ${failed.join('; ')}`
    )
    console.error(hint('do not send the report again.'))
    return EXIT_ERROR
  }
}

/** One evidence file → `POST /api/feedback/<ref>/evidence`. */
async function uploadEvidence(
  ctx: Ctx,
  ref: string,
  f: { path: string; bytes: Buffer; type: string }
): Promise<{ ok: true; data: DetailResponse } | { ok: false; error: string }> {
  const fd = new FormData()
  fd.append(
    'file',
    new Blob([new Uint8Array(f.bytes)], { type: f.type }),
    basename(f.path)
  )
  try {
    const res = await fetch(
      `${ctx.base}/api/feedback/${encodeURIComponent(ref)}/evidence`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}` },
        body: fd,
      }
    )
    const body = (await res.json().catch(() => null)) as
      | (DetailResponse & ErrorBody)
      | null
    if (res.ok && body?.feedback) return { ok: true, data: body }
    if (res.status === 413)
      return { ok: false, error: 'too large for one request (HTTP 413)' }
    return {
      ok: false,
      error: sanitizeField(body?.error ?? `HTTP ${res.status}`),
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ── list ────────────────────────────────────────────────────────────────

export interface FeedbackListOptions {
  status?: string
  kind?: string
  mine?: boolean
  limit?: string
  cursor?: string
  json?: boolean
}

export function listQuery(o: FeedbackListOptions): string | { error: string } {
  const q = new URLSearchParams()
  if (o.status !== undefined) {
    const s = o.status.toLowerCase()
    if (!(FEEDBACK_STATUSES as readonly string[]).includes(s))
      return {
        error: `invalid --status "${o.status}" (allowed: ${FEEDBACK_STATUSES.join(', ')})`,
      }
    q.set('status', s.toUpperCase())
  }
  if (o.kind !== undefined) {
    const k = o.kind.toLowerCase()
    if (!(FEEDBACK_KINDS as readonly string[]).includes(k))
      return {
        error: `invalid --kind "${o.kind}" (allowed: ${FEEDBACK_KINDS.join(', ')})`,
      }
    q.set('kind', k.toUpperCase())
  }
  if (o.mine) q.set('mine', 'true')
  if (o.limit !== undefined) {
    const n = Number(o.limit)
    if (!Number.isInteger(n) || n < 1 || n > 500)
      return { error: `invalid --limit "${o.limit}" (1-500)` }
    q.set('limit', String(n))
  }
  if (o.cursor !== undefined) {
    if (!/^\d{1,9}$/.test(o.cursor))
      return { error: `invalid --cursor "${o.cursor}"` }
    q.set('cursor', o.cursor)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

export function formatFeedbackList(
  items: FeedbackListItem[],
  opts: ListRenderOptions = {}
): string {
  const tty = opts.tty ?? Boolean(process.stdout.isTTY)
  return renderListTable(
    items.map(i => [
      i.ref,
      fmtEnum(i.kind),
      fmtEnum(i.status),
      String(i.replyCount),
      fmtInstant(i.createdAt, { tty }),
      oneCell(i.submittedBy?.name ?? NONE),
      oneCell(i.title),
    ]),
    {
      header: ['ID', 'KIND', 'STATUS', 'REPLIES', 'CREATED', 'BY', 'TITLE'],
      flex: 6,
      align: [undefined, undefined, undefined, 'right'],
      ...opts,
    }
  )
}

export async function feedbackList(
  o: FeedbackListOptions
): Promise<number | void> {
  const query = listQuery(o)
  if (typeof query !== 'string') {
    console.error(`Error: ${query.error}`)
    return EXIT_USAGE
  }
  const ctx = context()
  if (!ctx) return EXIT_ERROR
  const r = await getJson<ListResponse>(
    ctx,
    `/api/feedback${query}`,
    'feedback list'
  )
  if (!r) return EXIT_ERROR

  if (o.json) {
    emitJson(
      listEnvelope('feedback', r.feedback, {
        total: r.total,
        nextCursor: r.nextCursor,
      })
    )
    return
  }
  if (r.feedback.length === 0) {
    console.log(emptyState('feedback', `workspace ${ctx.workspaceSlug}`))
    if (!nextStepsSilenced())
      console.log(
        hint(
          `report a problem to the Lumo team with ${cmd('lumo feedback create --title "…"')}.`
        )
      )
    return
  }
  console.log(formatFeedbackList(r.feedback))
  if (r.nextCursor !== null || o.cursor !== undefined) {
    const lines = [`Showing ${r.feedback.length} of ${r.total}.`]
    if (r.nextCursor !== null)
      lines.push(
        `${NEXT_PAGE_PREFIX} ${buildCommand('feedback list', [
          ['--status', o.status],
          ['--kind', o.kind],
          ['--mine', o.mine],
          ['--limit', o.limit],
        ])} --cursor ${r.nextCursor}`
      )
    console.log(`\n${lines.join('\n')}`)
  }
}

// ── show ────────────────────────────────────────────────────────────────

export interface FeedbackShowOptions {
  json?: boolean
}

export function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The `Environment` section (whitelisted fields only; shared with staff show). */
export function environmentSection(
  env: FeedbackEnv | null,
  tty: boolean
): string[] {
  const out = [...sectionHeading('Environment')]
  if (!env) {
    out.push('  - (not sent: --no-env)')
    return out
  }
  const last = env.lastCommand
  out.push(
    kvBlock(
      [
        ['CLI', env.cliVersion ?? NONE],
        [
          'OS',
          [env.os, env.osRelease, env.arch].filter(Boolean).join(' ') || NONE,
        ],
        ['Node', env.nodeVersion ?? NONE],
        ['Agent', env.agentHost ? fmtEnum(env.agentHost) : NONE],
        [
          'Last command',
          last
            ? `${last.command}${last.flags.length ? ` (flags: ${last.flags.join(' ')})` : ''} → exit ${last.exitCode} at ${fmtInstant(last.at, { tty })}`
            : NONE,
        ],
      ],
      { indent: 2, color: false }
    )
  )
  return out
}

export function formatFeedbackDetail(
  d: DetailResponse,
  opts: { tty?: boolean } = {}
): string {
  const tty = opts.tty ?? Boolean(process.stdout.isTTY)
  const f = d.feedback
  const out: string[] = [`${f.ref}  ${sanitizeField(f.title)}`]
  out.push(
    kvBlock(
      [
        ['Kind', fmtEnum(f.kind)],
        ['Status', fmtEnum(f.status)],
        ['Submitted by', sanitizeField(f.submittedBy?.name ?? NONE)],
        ['Submitted', fmtInstant(f.createdAt, { tty })],
        ['Task', f.task ?? NONE],
        ['Session', f.sessionId ? sanitizeField(f.sessionId) : NONE],
      ],
      { color: false }
    )
  )
  if (f.secretsRedacted > 0)
    out.push(
      note(
        `${f.secretsRedacted} suspected secret${f.secretsRedacted === 1 ? ' was' : 's were'} redacted before saving.`
      )
    )
  if (f.steps.length > 0) {
    out.push(...sectionHeading('Steps'))
    f.steps.forEach((s, i) => out.push(`  ${i + 1}. ${sanitizeField(s)}`))
  }
  for (const [label, text] of [
    ['Expected', f.expected],
    ['Actual', f.actual],
  ] as const) {
    if (!text) continue
    out.push(...sectionHeading(label), ...indentLines(sanitizeField(text), 2))
  }
  if (f.evidence.length > 0) {
    out.push(...sectionHeading('Evidence'))
    for (const e of f.evidence)
      out.push(
        `  ${oneCell(e.filename)}  ${e.contentType}  ${fmtSize(e.size)}  ${sanitizeField(e.url)}`
      )
  }
  out.push(...environmentSection(f.environment, tty))
  out.push(...sectionHeading('Replies'))
  if (d.replies.length === 0) out.push('  -')
  for (const r of d.replies) {
    out.push(
      `  ${fmtInstant(r.createdAt, { tty })}  ${sanitizeField(r.author)}`
    )
    out.push(...indentLines(sanitizeField(r.body), 4))
  }
  return out.join('\n')
}

export async function feedbackShow(
  ref: string,
  o: FeedbackShowOptions
): Promise<number | void> {
  if (!/^(FB-)?\d{1,9}$/i.test(ref.trim())) {
    console.error(`Error: invalid feedback ref "${ref}" (expected FB-<n>)`)
    return EXIT_USAGE
  }
  const ctx = context()
  if (!ctx) return EXIT_ERROR
  const normalized = ref.trim().toUpperCase().startsWith('FB-')
    ? ref.trim().toUpperCase()
    : `FB-${ref.trim()}`
  const r = await getJson<DetailResponse>(
    ctx,
    `/api/feedback/${encodeURIComponent(normalized)}`,
    'feedback show',
    () => [
      `Error: feedback ${normalized} not found in workspace ${ctx.workspaceSlug}`,
      hint(`list feedback with ${cmd('lumo feedback list')}.`),
    ]
  )
  if (!r) return EXIT_ERROR
  if (o.json) {
    emitJson(detailEnvelope('feedback', r.feedback, { replies: r.replies }))
    return
  }
  console.log(formatFeedbackDetail(r))
}

// ── shared GET ──────────────────────────────────────────────────────────

async function getJson<T>(
  ctx: Ctx,
  path: string,
  what: string,
  notFound?: () => string[]
): Promise<T | null> {
  let res: Response
  try {
    res = await fetch(`${ctx.base}${path}`, {
      headers: { Authorization: `Bearer ${ctx.token}` },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: could not reach Lumo API at ${ctx.base} (${msg})`)
    return null
  }
  if (res.status === 401) {
    console.error(errAuth())
    return null
  }
  const body = (await res.json().catch(() => null)) as (T & ErrorBody) | null
  if (res.status === 404 && notFound) {
    for (const line of notFound()) console.error(line)
    return null
  }
  if (!res.ok || !body) {
    console.error(`Error: ${body?.error ?? httpFailed(what, res.status)}`)
    return null
  }
  return body
}
