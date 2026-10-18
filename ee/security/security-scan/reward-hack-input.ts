/**
 * LUM-1234 — assembling the reward-hack judge's input (pure functions).
 *
 *  - `selectSessionsForPr`: which agent sessions of the task belong to THIS
 *    PR — live activity inside `(windowStart, windowEnd]` AND an edit to a
 *    file the PR changes. Pruned payloads count as absent.
 *  - `renderRhTranscript`: one session's events as text, every event behind
 *    an `[e:<id>]` marker (the judge cites ids without the `e:` prefix).
 *  - `buildRhUserPrompt`: the fenced task requirement plus every fenced
 *    session, cut to `maxChars` (earliest tool results first, then earliest
 *    tool calls; user prompts and stop messages always stay), with the ids and
 *    edited files that actually made it into the prompt.
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

/** Tools whose `tool_input` names the file they wrote. */
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

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

/** The file a Write/Edit/MultiEdit/NotebookEdit event wrote, else null. */
export function rhEventFilePath(ev: RhEvent): string | null {
  if (ev.type !== 'POST_TOOL_USE' || isPrunedPayload(ev.payload)) return null
  if (!EDIT_TOOLS.has(toolNameOf(ev))) return null
  const input = asRecord(asRecord(ev.payload)?.tool_input)
  if (!input) return null
  const path = input.file_path ?? input.notebook_path
  return typeof path === 'string' && path.length > 0 ? path : null
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
  included: string[]
  /** Sessions with in-window activity whose every event was pruned. */
  excludedPruned: string[]
  /** Included sessions that lost at least one in-window event to pruning. */
  partiallyPruned: string[]
} {
  const { windowStart, windowEnd, prFiles } = args
  const included: string[] = []
  const excludedPruned: string[] = []
  const partiallyPruned: string[] = []
  for (const session of args.sessions) {
    const windowed = session.events.filter(e =>
      inWindow(e.createdAt, windowStart, windowEnd)
    )
    const live = session.events.filter(e => !isPrunedPayload(e.payload))
    if (session.events.length > 0 && live.length === 0) {
      // A session pruned long before this PR's window says nothing about
      // this PR; only one that was active inside it leaves a gap.
      if (windowed.length > 0) excludedPruned.push(session.id)
      continue
    }
    const liveInWindow = live.some(e =>
      inWindow(e.createdAt, windowStart, windowEnd)
    )
    const touchesPr = live.some(e => {
      const p = rhEventFilePath(e)
      return p !== null && prFiles.some(f => pathMatchesPrFile(p, f))
    })
    if (!liveInWindow || !touchesPr) continue
    included.push(session.id)
    if (windowed.some(e => isPrunedPayload(e.payload)))
      partiallyPruned.push(session.id)
  }
  return { included, excludedPruned, partiallyPruned }
}

// ─── rendering ──────────────────────────────────────────────────────────────

/** Defang anything in content that reads as our marker or our fences. */
const FORGED_MARKER = /\[\s*e\s*:/gi
const GAP = '[\\s\\u200B-\\u200F\\u2060\\uFEFF]*'
const spaced = (word: string) => word.split('').join(GAP)
const OUR_FENCE = new RegExp(
  `[<\\uFF1C]${GAP}\\/?${GAP}(?:${spaced('agent')}${GAP}[-_]${GAP}${spaced('session')}|${spaced('task')}${GAP}[-_]${GAP}${spaced('requirement')})[^<>\\uFF1C\\uFF1E]*[>\\uFF1E]`,
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
  filePath: string | null
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
    filePath: null,
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
      filePath: rhEventFilePath(ev),
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

function blockText(b: RhBlock, dropResult: boolean): string {
  return [b.head, b.body, dropResult ? '' : b.result]
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
  return sanitizeField(v).replace(/[^A-Za-z0-9:._-]/g, '_')
}

/** Mutable cut state over the blocks of every session. */
interface CutState {
  droppedResults: Set<RhBlock>
  droppedBlocks: Set<RhBlock>
}

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
  /** For every id in `eventIds`: the file it wrote (Write/Edit/…), else null. */
  eventFile: Map<string, string | null>
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

  // Drop order: earliest tool results, then earliest tool calls. Prompts and
  // stop messages are never candidates.
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
  }

  const assemble = () => {
    const sessionParts = sessions.map(s => {
      const kept = s.blocks.filter(b => !state.droppedBlocks.has(b))
      const text = kept
        .map(b => blockText(b, state.droppedResults.has(b)))
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
  let built = assemble()
  // Guarding can change lengths slightly (masked values, notices), so cut by
  // the raw estimate, re-assemble, and repeat until it fits or nothing is left.
  while (built.prompt.length > args.maxChars && next < units.length) {
    truncated = true
    let excess = built.prompt.length - args.maxChars
    while (excess > 0 && next < units.length) {
      const u = units[next++]!
      if (u.result) state.droppedResults.add(u.block)
      else state.droppedBlocks.add(u.block)
      excess -= u.size
    }
    built = assemble()
  }
  if (built.prompt.length > args.maxChars) truncated = true

  const eventIds = new Set<string>()
  const eventFile = new Map<string, string | null>()
  for (const part of built.sessionParts) {
    for (const b of part.kept) {
      // Present only if the marker survived guarding verbatim.
      if (!part.text.includes(`[e:${b.eventId}]`)) continue
      eventIds.add(b.eventId)
      eventFile.set(b.eventId, b.filePath)
    }
  }
  return { prompt: built.prompt, truncated, eventIds, eventFile }
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
