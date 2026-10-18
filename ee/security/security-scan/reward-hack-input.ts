/**
 * LUM-1234 — assembling the reward-hack judge's input (pure functions).
 *
 *  - `selectSessionsForPr`: which agent sessions of the task belong to THIS
 *    PR — a live edit to a file the PR changes inside `(windowStart,
 *    windowEnd]`; returns only the in-window events. Pruned payloads count
 *    as absent, and a loss of in-window events is always reported.
 *  - `renderRhTranscript`: one session's events as text, every event behind
 *    an `[e:<id>]` marker (the judge cites ids without the `e:` prefix).
 *  - `buildRhUserPrompt`: the fenced task requirement plus every fenced
 *    session, cut to `maxChars` (earliest tool results first, then earliest
 *    tool calls, then the bodies of the earliest prompts / stop messages —
 *    their markers always stay), with the ids and edited files that made it
 *    into the prompt, and `overCap` when even that cannot fit.
 *  - `rhWatermark`: sessionId → last event id, to tell whether a re-run sees
 *    new activity.
 *
 * Every piece of session text and the requirement is untrusted: it goes
 * through `sanitizeField` + `guardInjectedText` and our own fence names and
 * the `[e:` marker are defanged inside it, so content can neither close its
 * fence nor forge an event id the model would then cite.
 */
import { sanitizeField } from '@/shared/src/sanitize'
import { guardInjectedText } from '@/lib/security-scan/inject-guard'
import { isPrunedPayload } from '@/lib/hook-event/retention'
import {
  APPLY_PATCH_TOOL,
  applyPatchText,
  parseApplyPatch,
} from '@/shared/src/apply-patch'

export interface RhEvent {
  id: string
  sessionId: string
  type: string
  toolName: string | null
  payload: unknown
  createdAt: Date
}

export interface RhSession {
  id: string
  events: RhEvent[]
}

export interface RhCaps {
  prompt: number
  toolInput: number
  toolResult: number
  stop: number
}

export const RH_DEFAULT_CAPS: RhCaps = {
  prompt: 4000,
  toolInput: 3000,
  toolResult: 1500,
  stop: 4000,
}

/**
 * Our cap on the task-requirement block. Not in the brief's numbers: a
 * requirement never shrinks under the transcript cut, so without its own cap
 * a huge description or comment thread could push the prompt past `maxChars`
 * on its own. Cutting it sets `truncated`.
 */
export const RH_REQUIREMENT_MAX_CHARS = 20_000

/**
 * Tools that write files: `tool_input` names the file — or, for Codex's only
 * write tool `apply_patch` (LUM-1051), the patch headers name every file.
 */
const EDIT_TOOLS = new Set([
  'Write',
  'Edit',
  'MultiEdit',
  'NotebookEdit',
  APPLY_PATCH_TOOL,
])

/** A PR file as the runner reads it: its path and its diff hunks, if sent. */
export interface RhPrFile {
  filename: string
  /** Unified-diff hunks; null when GitHub did not send them. */
  patch: string | null
}

// ─── payload readers (mirroring session-summary/compact-events) ─────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function getStr(payload: unknown, field: string): string | null {
  const v = asRecord(payload)?.[field]
  return typeof v === 'string' ? v : null
}

function toolNameOf(ev: RhEvent): string {
  return ev.toolName ?? getStr(ev.payload, 'tool_name') ?? 'Unknown'
}

/**
 * Every file a write event touched: the `file_path` / `notebook_path` of a
 * Write/Edit/MultiEdit/NotebookEdit, or each file an `apply_patch` adds,
 * updates (its rename target too) or deletes, in patch order. [] for any
 * other event.
 */
export function rhEventFilePaths(ev: RhEvent): string[] {
  if (ev.type !== 'POST_TOOL_USE' || isPrunedPayload(ev.payload)) return []
  const tool = toolNameOf(ev)
  if (!EDIT_TOOLS.has(tool)) return []
  const input = asRecord(asRecord(ev.payload)?.tool_input)
  if (!input) return []
  if (tool === APPLY_PATCH_TOOL) {
    const text = applyPatchText(input)
    if (text === null) return []
    const out: string[] = []
    for (const f of parseApplyPatch(text).files) {
      for (const p of [f.path, f.moveTo]) if (p && !out.includes(p)) out.push(p)
    }
    return out
  }
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' && path.length > 0 ? [path] : []
}

/** The (first) file a write event touched, else null — for labels. */
export function rhEventFilePath(ev: RhEvent): string | null {
  return rhEventFilePaths(ev)[0] ?? null
}

/** A line worth matching against the diff: not just a brace or a keyword. */
function nonTrivialLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length >= 6 && /[A-Za-z0-9]/.test(line) && !out.includes(line))
      out.push(line)
  }
  return out
}

function linesAddedBy(oldText: unknown, newText: unknown): string[] {
  if (typeof newText !== 'string') return []
  const before = new Set(
    typeof oldText === 'string' ? oldText.split('\n').map(l => l.trim()) : []
  )
  return nonTrivialLines(newText).filter(l => !before.has(l))
}

/**
 * The non-trivial lines a write event ADDED (an Edit's `new_string` lines
 * that were not in its `old_string`, a Write's content, an apply_patch's `+`
 * lines), trimmed. Null when there is nothing to check against the PR diff:
 * not a write, a notebook, or a write that only removed or reshuffled lines.
 */
export function rhEventAddedLines(ev: RhEvent): string[] | null {
  if (rhEventFilePaths(ev).length === 0) return null
  const tool = toolNameOf(ev)
  const input = asRecord(asRecord(ev.payload)?.tool_input) ?? {}
  let lines: string[] = []
  if (tool === APPLY_PATCH_TOOL) {
    lines = nonTrivialLines(
      parseApplyPatch(applyPatchText(input) ?? '').addedText
    )
  } else if (tool === 'Write') {
    lines =
      typeof input.content === 'string' ? nonTrivialLines(input.content) : []
  } else if (tool === 'Edit') {
    lines = linesAddedBy(input.old_string, input.new_string)
  } else if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits) {
      const r = asRecord(e)
      for (const l of linesAddedBy(r?.old_string, r?.new_string))
        if (!lines.includes(l)) lines.push(l)
    }
  }
  return lines.length > 0 ? lines : null
}

/**
 * The trimmed `+` lines of each PR file's diff, keyed by PR path; null for a
 * file GitHub sent no hunks for (nothing can be told about it).
 */
export function prAddedLines(
  files: RhPrFile[]
): Map<string, Set<string> | null> {
  const out = new Map<string, Set<string> | null>()
  for (const f of files) {
    if (f.patch === null) {
      out.set(f.filename, null)
      continue
    }
    const set = new Set<string>()
    for (const line of f.patch.split('\n'))
      if (line.startsWith('+') && !line.startsWith('+++'))
        set.add(line.slice(1).trim())
    out.set(f.filename, set)
  }
  return out
}

// ─── session selection ──────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

/**
 * A hook `file_path` is usually absolute (`/…/worktree/src/a.ts`), a PR file
 * repo-relative (`src/a.ts`): match on a whole-segment suffix, never a
 * substring (`/mysrc/a.ts` is not `src/a.ts`).
 */
export function pathMatchesPrFile(filePath: string, prFile: string): boolean {
  const abs = normalizePath(filePath)
  const rel = normalizePath(prFile)
    .replace(/^(\.\/)+/, '')
    .replace(/^\/+/, '')
  if (!rel) return false
  return abs === rel || abs.endsWith(`/${rel}`)
}

function inWindow(at: Date, start: Date | null, end: Date): boolean {
  const t = at.getTime()
  return (start === null || t > start.getTime()) && t <= end.getTime()
}

export function selectSessionsForPr(args: {
  sessions: RhSession[]
  windowStart: Date | null
  windowEnd: Date
  prFiles: string[]
}): {
  /**
   * Sessions that belong to this PR, each carrying ONLY its live in-window
   * events — render these, never the full session, so an earlier PR's
   * trajectory is not judged against this one.
   */
  included: RhSession[]
  /**
   * Sessions not included that lost in-window events to pruning: their part
   * of this PR cannot be judged (fully pruned, or only the in-window part).
   */
  excludedPruned: string[]
  /** Included sessions that lost at least one in-window event to pruning. */
  partiallyPruned: string[]
} {
  const { windowStart, windowEnd, prFiles } = args
  const included: RhSession[] = []
  const excludedPruned: string[] = []
  const partiallyPruned: string[] = []
  for (const session of args.sessions) {
    const windowed = session.events.filter(e =>
      inWindow(e.createdAt, windowStart, windowEnd)
    )
    const liveWindowed = windowed.filter(e => !isPrunedPayload(e.payload))
    const lostSome = liveWindowed.length < windowed.length
    // Both conditions are judged on live IN-WINDOW events only: an edit made
    // before the previous merge belongs to that PR, not this one.
    const touchesPr = liveWindowed.some(e =>
      rhEventFilePaths(e).some(p => prFiles.some(f => pathMatchesPrFile(p, f)))
    )
    if (touchesPr) {
      included.push({ id: session.id, events: liveWindowed })
      if (lostSome) partiallyPruned.push(session.id)
    } else if (lostSome) {
      // The pruned in-window events may have been this PR's edits; the loss
      // must surface, never read as "no session".
      excludedPruned.push(session.id)
    }
  }
  return { included, excludedPruned, partiallyPruned }
}

// ─── rendering ──────────────────────────────────────────────────────────────

/** Defang anything in content that reads as our marker or our fences. */
const FORGED_MARKER = /\[\s*e\s*:/gi
const GAP = '[\\s\\u200B-\\u200F\\u2060\\uFEFF]*'
const spaced = (word: string) => word.split('').join(GAP)
const OUR_FENCE = new RegExp(
  `[<\\uFF1C]${GAP}\\/?${GAP}(?:${spaced('agent')}${GAP}[-_]${GAP}${spaced('session')}|${spaced('task')}${GAP}[-_]${GAP}${spaced('requirement')}|${spaced('pr')}${GAP}[-_]${GAP}${spaced('diff')})[^<>\\uFF1C\\uFF1E]*[>\\uFF1E]`,
  'gi'
)

function defang(text: string): string {
  return text
    .replace(FORGED_MARKER, '(e:')
    .replace(OUR_FENCE, m => m.replace(/[<＜]/g, '(').replace(/[>＞]/g, ')'))
}

function cut(text: string, cap: number): string {
  if (text.length <= cap) return text
  return `${text.slice(0, cap)}\n…[truncated ${text.length - cap} chars]`
}

function stringifyValue(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/**
 * Share one input budget across the fields: short fields (a path, a flag)
 * keep everything, the long ones split what is left equally.
 */
function renderToolInput(input: Record<string, unknown> | null, cap: number) {
  if (!input) return ''
  const fields = Object.entries(input).map(([k, v]) => ({
    k,
    v: stringifyValue(v),
  }))
  const shares = new Map<string, number>()
  let budget = cap
  let left = fields.length
  for (const f of [...fields].sort((a, b) => a.v.length - b.v.length)) {
    const share = Math.max(0, Math.floor(budget / left))
    const take = Math.min(f.v.length, share)
    shares.set(f.k, take)
    budget -= take
    left--
  }
  return fields
    .map(f => `${f.k}: ${cut(f.v, Math.max(shares.get(f.k) ?? 0, 1))}`)
    .join('\n')
}

function renderToolResponse(payload: unknown): string {
  const raw = asRecord(payload)?.tool_response
  if (raw === undefined || raw === null) return ''
  // LUM-1051: Codex sends the output as a bare string.
  if (typeof raw === 'string') return raw
  const rec = asRecord(raw)
  if (rec) {
    const stdout = typeof rec.stdout === 'string' ? rec.stdout : null
    const stderr = typeof rec.stderr === 'string' ? rec.stderr : null
    if (stdout !== null || stderr !== null)
      return [stdout, stderr ? `[stderr]\n${stderr}` : null]
        .filter((s): s is string => !!s)
        .join('\n')
    // An Edit/Write response echoes the whole original file; drop it.
    const rest = { ...rec }
    delete rest.originalFile
    return stringifyValue(rest)
  }
  return stringifyValue(raw)
}

type RhBlockKind = 'prompt' | 'tool' | 'stop'

interface RhBlock {
  eventId: string
  createdAt: Date
  kind: RhBlockKind
  filePaths: string[]
  /** Header line carrying the marker. */
  head: string
  /** prompt / stop text, or a tool call's input. */
  body: string
  /** Tool result section (tools only), '' when none. */
  result: string
}

function toBlock(ev: RhEvent, caps: RhCaps): RhBlock | null {
  if (isPrunedPayload(ev.payload)) return null
  const marker = `[e:${defang(sanitizeField(ev.id))}]`
  const base = {
    eventId: ev.id,
    createdAt: ev.createdAt,
    filePaths: [] as string[],
    result: '',
  }
  const clean = (s: string) => defang(sanitizeField(s))
  if (ev.type === 'USER_PROMPT_SUBMIT') {
    const text = getStr(ev.payload, 'prompt') ?? ''
    return {
      ...base,
      kind: 'prompt',
      head: `${marker} ### user prompt`,
      body: cut(clean(text), caps.prompt),
    }
  }
  if (ev.type === 'STOP') {
    const text = getStr(ev.payload, 'last_assistant_message') ?? ''
    return {
      ...base,
      kind: 'stop',
      head: `${marker} ### assistant (turn end)`,
      body: cut(clean(text), caps.stop),
    }
  }
  if (ev.type === 'POST_TOOL_USE') {
    const input = asRecord(asRecord(ev.payload)?.tool_input)
    const response = renderToolResponse(ev.payload)
    return {
      ...base,
      kind: 'tool',
      filePaths: rhEventFilePaths(ev),
      head: `${marker} [tool call: ${clean(toolNameOf(ev))}]`,
      body: clean(renderToolInput(input, caps.toolInput)),
      result: response
        ? `[tool result]\n${cut(clean(response), caps.toolResult)}`
        : '',
    }
  }
  return null
}

function renderBlocks(events: RhEvent[], caps: RhCaps): RhBlock[] {
  return events
    .map(e => toBlock(e, caps))
    .filter((b): b is RhBlock => b !== null)
}

function shortenBody(body: string, keep: number | undefined): string {
  if (keep === undefined || keep >= body.length) return body
  const note = `…[truncated ${body.length - keep} chars]`
  return keep > 0 ? `${body.slice(0, keep)}\n${note}` : note
}

function blockText(b: RhBlock, dropResult: boolean, bodyKeep?: number): string {
  return [b.head, shortenBody(b.body, bodyKeep), dropResult ? '' : b.result]
    .filter(s => s.length > 0)
    .join('\n')
}

export function renderRhTranscript(
  events: RhEvent[],
  caps: RhCaps = RH_DEFAULT_CAPS
): string {
  return renderBlocks(events, caps)
    .map(b => blockText(b, false))
    .join('\n\n')
}

// ─── the user prompt ────────────────────────────────────────────────────────

function fence(tag: string, attrs: string, raw: string): string {
  const g = guardInjectedText(raw)
  const head = attrs ? `<${tag} ${attrs}>` : `<${tag}>`
  return [head, ...g.notices, g.text, `</${tag}>`].join('\n')
}

function attrValue(v: string): string {
  return sanitizeField(v).replace(/[^A-Za-z0-9:._/-]/g, '_')
}

/** Mutable cut state over the blocks of every session. */
interface CutState {
  droppedResults: Set<RhBlock>
  droppedBlocks: Set<RhBlock>
  /** prompt / stop blocks whose body is cut to this many characters. */
  bodyKeep: Map<RhBlock, number>
}

/** Room a shortened body's `…[truncated N chars]` note takes. */
const SHORTEN_NOTE_CHARS = 32

export function buildRhUserPrompt(args: {
  requirement: string
  transcripts: { sessionId: string; events: RhEvent[] }[]
  maxChars: number
  caps?: RhCaps
}): {
  prompt: string
  truncated: boolean
  /** Ids whose `[e:<id>]` marker is in the final prompt. */
  eventIds: Set<string>
  /** For every id in `eventIds`: the files it wrote (Write/Edit/apply_patch…), else []. */
  eventFile: Map<string, string[]>
  /**
   * The prompt is still over `maxChars` after every cut (the markers and
   * fences alone do not fit). The caller must not send it to the model.
   */
  overCap: boolean
} {
  const caps = args.caps ?? RH_DEFAULT_CAPS
  let truncated = false

  let requirementRaw = sanitizeField(args.requirement)
  if (requirementRaw.length > RH_REQUIREMENT_MAX_CHARS) {
    requirementRaw = cut(requirementRaw, RH_REQUIREMENT_MAX_CHARS)
    truncated = true
  }
  const requirementBlock = fence('task-requirement', '', defang(requirementRaw))

  const sessions = args.transcripts.map(t => ({
    sessionId: t.sessionId,
    blocks: renderBlocks(t.events, caps),
  }))

  // Cut order: earliest tool results, then earliest tool calls (whole
  // blocks), then — last resort — the bodies of the earliest prompts / stop
  // messages, which always keep their marker.
  const tools = sessions
    .flatMap(s => s.blocks)
    .filter(b => b.kind === 'tool')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const units: { block: RhBlock; result: boolean; size: number }[] = [
    ...tools
      .filter(b => b.result.length > 0)
      .map(b => ({ block: b, result: true, size: b.result.length + 1 })),
    ...tools.map(b => ({
      block: b,
      result: false,
      size: b.head.length + b.body.length + 3,
    })),
  ]

  const state: CutState = {
    droppedResults: new Set(),
    droppedBlocks: new Set(),
    bodyKeep: new Map(),
  }
  const shortenable = sessions
    .flatMap(s => s.blocks)
    .filter(b => b.kind !== 'tool' && b.body.length > SHORTEN_NOTE_CHARS)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())

  const assemble = () => {
    const sessionParts = sessions.map(s => {
      const kept = s.blocks.filter(b => !state.droppedBlocks.has(b))
      const text = kept
        .map(b =>
          blockText(b, state.droppedResults.has(b), state.bodyKeep.get(b))
        )
        .join('\n\n')
      return {
        kept,
        text: fence('agent-session', `id="${attrValue(s.sessionId)}"`, text),
      }
    })
    return {
      prompt: [requirementBlock, ...sessionParts.map(p => p.text)].join('\n\n'),
      sessionParts,
    }
  }

  let next = 0
  let shortenAt = 0
  let built = assemble()
  // Guarding can change lengths slightly (masked values, notices), so cut by
  // the raw estimate, re-assemble, and repeat until it fits or nothing is left.
  while (built.prompt.length > args.maxChars) {
    truncated = true
    let excess = built.prompt.length - args.maxChars
    let progressed = false
    while (excess > 0 && next < units.length) {
      const u = units[next++]!
      if (u.result) state.droppedResults.add(u.block)
      else state.droppedBlocks.add(u.block)
      excess -= u.size
      progressed = true
    }
    while (excess > 0 && shortenAt < shortenable.length) {
      const b = shortenable[shortenAt]!
      const current = state.bodyKeep.get(b) ?? b.body.length
      const target = Math.max(0, current - excess - SHORTEN_NOTE_CHARS)
      if (target < current) {
        state.bodyKeep.set(b, target)
        progressed = true
      }
      excess -= current - target - SHORTEN_NOTE_CHARS
      if (target === 0) shortenAt++
    }
    if (!progressed) break
    built = assemble()
  }
  const overCap = built.prompt.length > args.maxChars

  const eventIds = new Set<string>()
  const eventFile = new Map<string, string[]>()
  for (const part of built.sessionParts) {
    for (const b of part.kept) {
      // Present only if the marker survived guarding verbatim.
      if (!part.text.includes(`[e:${b.eventId}]`)) continue
      eventIds.add(b.eventId)
      eventFile.set(b.eventId, b.filePaths)
    }
  }
  return { prompt: built.prompt, truncated, eventIds, eventFile, overCap }
}

// ─── the PR diff for the refute call ───────────────────────────────────────

/** Our caps on the diff the refute call sees (per file, and in total). */
export const RH_PR_DIFF_FILE_MAX_CHARS = 8_000
export const RH_PR_DIFF_MAX_CHARS = 24_000

/**
 * The current PR hunks of the files `paths` name, each fenced as untrusted
 * text — what will merge, so the refute call can tell an edit that is still
 * there from one later corrected. '' when no such file has hunks.
 */
export function buildRhPrDiffBlock(
  prFiles: RhPrFile[],
  paths: string[]
): string {
  const parts: string[] = []
  let left = RH_PR_DIFF_MAX_CHARS
  for (const f of prFiles) {
    if (left <= 0) break
    if (f.patch === null) continue
    if (!paths.some(p => pathMatchesPrFile(p, f.filename))) continue
    const body = cut(
      defang(sanitizeField(f.patch)),
      Math.min(RH_PR_DIFF_FILE_MAX_CHARS, left)
    )
    left -= body.length
    parts.push(fence('pr-diff', `file="${attrValue(f.filename)}"`, body))
  }
  return parts.join('\n\n')
}

// ─── watermark ──────────────────────────────────────────────────────────────

export function rhWatermark(sessions: RhSession[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of sessions) {
    let last: RhEvent | null = null
    for (const e of s.events) {
      if (!last || e.createdAt.getTime() >= last.createdAt.getTime()) last = e
    }
    if (last) out[s.id] = last.id
  }
  return out
}
