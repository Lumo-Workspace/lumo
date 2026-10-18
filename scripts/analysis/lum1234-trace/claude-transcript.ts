/**
 * LUM-1234 — local Claude Code transcripts (`~/.claude/projects/**.jsonl`)
 * as the reward-hack layer's `RhEvent`s, so the offline calibration judges
 * the same kind of content the product's hooks record (pure; no IO).
 *
 * Rules (each mirrors what a hook would have recorded):
 *
 *  - USER_PROMPT_SUBMIT `{ prompt }` — a genuine user message only:
 *    `type: 'user'`, not `isMeta` (skill / command expansions), not
 *    `isCompactSummary` / `isVisibleInTranscriptOnly`, an `origin.kind` (when
 *    present) of `human` or `coordinator` (the orchestrating agent's message
 *    to a subagent — that agent's "user"); never a message carrying a
 *    `tool_result`. Wrapper blocks are removed (`<system-reminder>`,
 *    `<local-command-*>`, `<task-notification>`, `<ci-monitor-event>`); a
 *    slash command becomes `/<name> <args>`, what the user typed; an
 *    interruption marker or a message empty after that is not a prompt.
 *  - POST_TOOL_USE `{ tool_name, tool_input, tool_response }` — an assistant
 *    `tool_use` paired with the `tool_result` of the same id, stamped at the
 *    result. An errored result is skipped (the product records it as
 *    POST_TOOL_USE_FAILURE, which the layer does not read), and so is a call
 *    with no result. `tool_response` is the entry's structured
 *    `toolUseResult` when the message carries this one result (what the hook
 *    receives), else the result text; long strings are cut to
 *    `TOOL_RESPONSE_MAX_CHARS` and an Edit/Write echo of the original file is
 *    dropped. `tool_input` is kept whole (the gates read the added lines).
 *  - STOP `{ last_assistant_message }` — the last assistant text of a turn:
 *    before the next genuine prompt of the same session, or at the end.
 *    Synthetic and API-error assistant messages are not text.
 *
 * Ids: the entry `uuid` (prompts, stops) or the `tool_use_id`; repeats (a
 * resumed or forked session copies history) are dropped. Session: the
 * transcript `sessionId`, or `<sessionId>:<agentId>` for a subagent
 * (sidechain) transcript.
 *
 * Task attribution (`attribution`, default `branch+path`). The product binds a
 * session to its task; transcripts have no binding, so it is rebuilt:
 *  - branch: the entry's `gitBranch` `lumo/LUM-<n>-…` → `LUM-<n>`; any other
 *    branch (main, HEAD, …) is no task's. Always wins when present.
 *  - path (`branch+path` only): a write (Write/Edit/MultiEdit/NotebookEdit/
 *    apply_patch) whose file paths lie under ONE task worktree
 *    (`…/.worktrees/LUM-<n>-…/` or `…/.claude/worktrees/LUM-<n>-…/`, a whole
 *    path segment — never a task id found anywhere in the text); any other
 *    tool event by the entry's `cwd` under such a worktree.
 *  - subagent (`branch+path` only): a subagent transcript works on one task.
 *    When its writes name exactly one task by path, its prompts, STOPs and
 *    other tool events with no task of their own take that task.
 *    Subagent entries carry the parent's branch and cwd (often `main` and the
 *    main checkout), so without this their edits in a task worktree are lost.
 */
import {
  rhEventFilePaths,
  type RhEvent,
} from '@/ee/security/security-scan/reward-hack-input'

/** Our cut on one tool response string kept per event. */
export const TOOL_RESPONSE_MAX_CHARS = 8_000

export type RhAttribution = 'branch' | 'branch+path'

export interface AttributedRhEvent {
  event: RhEvent
  /** `LUM-<n>` the event is attributed to; null when none. */
  task: string | null
  /** Which rule attributed it (null when `task` is null). */
  via: 'branch' | 'path' | 'subagent' | null
}

type Rec = Record<string, unknown>

function asRecord(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

const TASK_BRANCH = /^lumo\/(LUM-\d+)(?:-|$)/

export function taskOfBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  return TASK_BRANCH.exec(branch)?.[1] ?? null
}

const WORKTREE_TASK =
  /(?:^|\/)(?:\.worktrees|\.claude\/worktrees)\/(LUM-\d+)(?:-[^/]*)?(?=\/|$)/

/**
 * `LUM-<n>` when `path` lies under a task worktree directory
 * (`.worktrees/LUM-<n>-…` or `.claude/worktrees/LUM-<n>-…`, matched as whole
 * path segments); null otherwise.
 */
export function taskOfWorktreePath(
  path: string | null | undefined
): string | null {
  if (!path) return null
  return WORKTREE_TASK.exec(path.replace(/\\/g, '/'))?.[1] ?? null
}

/** The one task every worktree path of a write names; null if none or mixed. */
function taskOfPaths(paths: string[]): string | null {
  const tasks = new Set(
    paths.map(taskOfWorktreePath).filter((t): t is string => t !== null)
  )
  return tasks.size === 1 ? [...tasks][0]! : null
}

/** `sessionId`, or `<sessionId>:<agentId>` for a subagent's entries. */
export function transcriptSessionId(entry: Rec): string | null {
  const sid = str(entry.sessionId)
  if (!sid) return null
  if (entry.isSidechain === true) {
    const agent = str(entry.agentId)
    return `${sid}:${agent ?? 'sidechain'}`
  }
  return sid
}

const WRAPPER_BLOCKS =
  /<(system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|task-notification|ci-monitor-event)>[\s\S]*?<\/\1>/g

function tagText(text: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)
  return m ? m[1]!.trim() : null
}

/** The prompt a genuine user message stands for; null when it is not one. */
export function genuinePromptText(entry: Rec): string | null {
  if (entry.type !== 'user') return null
  if (
    entry.isMeta === true ||
    entry.isCompactSummary === true ||
    entry.isVisibleInTranscriptOnly === true
  )
    return null
  const origin = str(asRecord(entry.origin)?.kind)
  if (origin !== null && origin !== 'human' && origin !== 'coordinator')
    return null
  const content = asRecord(entry.message)?.content
  let text: string
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const blocks = content.map(asRecord)
    if (blocks.some(b => b?.type === 'tool_result')) return null
    text = blocks
      .filter(b => b?.type === 'text')
      .map(b => str(b!.text) ?? '')
      .join('\n')
  } else return null

  const command = tagText(text, 'command-name')
  if (command !== null) {
    const args = tagText(text, 'command-args') ?? ''
    return `${command} ${args}`.trim() || null
  }
  const cleaned = text.replace(WRAPPER_BLOCKS, '').trim()
  if (cleaned.length === 0) return null
  if (/^\[Request interrupted by user/.test(cleaned)) return null
  return cleaned
}

/** An assistant entry's text (its text blocks joined); null when none. */
function assistantText(entry: Rec): string | null {
  if (entry.type !== 'assistant' || entry.isApiErrorMessage === true)
    return null
  const message = asRecord(entry.message)
  if (message?.model === '<synthetic>') return null
  const content = message?.content
  if (typeof content === 'string') return content.trim() || null
  if (!Array.isArray(content)) return null
  const text = content
    .map(asRecord)
    .filter(b => b?.type === 'text')
    .map(b => str(b!.text) ?? '')
    .join('\n')
    .trim()
  return text || null
}

function clip(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n…[cut ${text.length - max} chars]`
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(asRecord)
    .filter(b => b?.type === 'text')
    .map(b => str(b!.text) ?? '')
    .join('\n')
}

/** A tool response as the hook would carry it, with long text cut. */
export function clipToolResponse(raw: unknown): unknown {
  if (typeof raw === 'string') return clip(raw, TOOL_RESPONSE_MAX_CHARS)
  const rec = asRecord(raw)
  if (!rec) {
    if (raw === undefined || raw === null) return raw
    let json: string
    try {
      json = JSON.stringify(raw) ?? ''
    } catch {
      json = String(raw)
    }
    return json.length > TOOL_RESPONSE_MAX_CHARS
      ? clip(json, TOOL_RESPONSE_MAX_CHARS)
      : raw
  }
  const out: Rec = {}
  for (const [k, v] of Object.entries(rec)) {
    if (k === 'originalFile') continue
    out[k] = typeof v === 'string' ? clip(v, TOOL_RESPONSE_MAX_CHARS) : v
  }
  let size = 0
  try {
    size = JSON.stringify(out)?.length ?? 0
  } catch {
    size = Infinity
  }
  // Nested bulk (a structured patch, a file listing): keep a cut string.
  if (size > TOOL_RESPONSE_MAX_CHARS * 2) {
    let json: string
    try {
      json = JSON.stringify(out) ?? ''
    } catch {
      json = ''
    }
    return clip(json, TOOL_RESPONSE_MAX_CHARS)
  }
  return out
}

function timeOf(entry: Rec): Date | null {
  const t = str(entry.timestamp)
  if (!t) return null
  const d = new Date(t)
  return Number.isNaN(d.getTime()) ? null : d
}

interface PendingTool {
  name: string
  input: unknown
  session: string
  branch: string | null
  cwd: string | null
}

interface LastText {
  id: string
  text: string
  at: Date
  branch: string | null
}

interface Raw {
  event: RhEvent
  branchTask: string | null
  pathTask: string | null
  /** The task a write's file paths name (subagent attribution). */
  writeTask: string | null
}

/**
 * Feed entries in file order (one parser per transcript file, or across
 * files — state is kept per session), then `finish()` for every event.
 */
export class ClaudeTranscriptParser {
  private readonly out: Raw[] = []
  private readonly seen = new Set<string>()
  private readonly pending = new Map<string, PendingTool>()
  private readonly lastText = new Map<string, LastText>()
  private readonly sidechains = new Set<string>()

  constructor(private readonly attribution: RhAttribution = 'branch+path') {}

  private emit(
    id: string,
    session: string,
    type: RhEvent['type'],
    toolName: string | null,
    payload: unknown,
    at: Date,
    branch: string | null,
    cwd: string | null = null
  ): void {
    if (this.seen.has(id)) return
    this.seen.add(id)
    const event: RhEvent = {
      id,
      sessionId: session,
      type,
      toolName,
      payload,
      createdAt: at,
    }
    const writes = type === 'POST_TOOL_USE' ? rhEventFilePaths(event) : []
    const writeTask = writes.length > 0 ? taskOfPaths(writes) : null
    // A write is placed by the files it wrote, never by where it ran from.
    const pathTask =
      writes.length > 0
        ? writeTask
        : type === 'POST_TOOL_USE'
          ? taskOfWorktreePath(cwd)
          : null
    this.out.push({
      event,
      branchTask: taskOfBranch(branch),
      pathTask,
      writeTask,
    })
  }

  private flushStop(session: string): void {
    const last = this.lastText.get(session)
    if (!last) return
    this.lastText.delete(session)
    this.emit(
      last.id,
      session,
      'STOP',
      null,
      { last_assistant_message: last.text },
      last.at,
      last.branch
    )
  }

  push(raw: unknown): void {
    const entry = asRecord(raw)
    if (!entry) return
    const session = transcriptSessionId(entry)
    const at = timeOf(entry)
    const uuid = str(entry.uuid)
    const branch = str(entry.gitBranch)
    const cwd = str(entry.cwd)
    if (!session || !at) return
    if (entry.isSidechain === true) this.sidechains.add(session)

    if (entry.type === 'assistant') {
      const content = asRecord(entry.message)?.content
      if (Array.isArray(content))
        for (const b of content.map(asRecord)) {
          if (b?.type !== 'tool_use') continue
          const id = str(b.id)
          const name = str(b.name)
          if (id && name)
            this.pending.set(id, {
              name,
              input: b.input,
              session,
              branch,
              cwd,
            })
        }
      const text = assistantText(entry)
      if (text && uuid)
        this.lastText.set(session, { id: uuid, text, at, branch })
      return
    }
    if (entry.type !== 'user') return

    const content = asRecord(entry.message)?.content
    if (Array.isArray(content)) {
      const results = content
        .map(asRecord)
        .filter((b): b is Rec => b?.type === 'tool_result')
      for (const r of results) {
        const id = str(r.tool_use_id)
        if (!id) continue
        const call = this.pending.get(id)
        if (!call) continue
        this.pending.delete(id)
        if (r.is_error === true) continue
        const response =
          results.length === 1 && entry.toolUseResult !== undefined
            ? entry.toolUseResult
            : resultText(r.content)
        this.emit(
          id,
          call.session,
          'POST_TOOL_USE',
          call.name,
          {
            tool_name: call.name,
            tool_input: call.input,
            tool_response: clipToolResponse(response),
          },
          at,
          branch ?? call.branch,
          cwd ?? call.cwd
        )
      }
      if (results.length > 0) return
    }

    const prompt = genuinePromptText(entry)
    if (prompt === null || !uuid) return
    this.flushStop(session)
    this.emit(uuid, session, 'USER_PROMPT_SUBMIT', null, { prompt }, at, branch)
  }

  finish(): AttributedRhEvent[] {
    for (const session of [...this.lastText.keys()]) this.flushStop(session)
    if (this.attribution === 'branch')
      return this.out.map(r => ({
        event: r.event,
        task: r.branchTask,
        via: r.branchTask ? 'branch' : null,
      }))
    // A subagent session's task: the one task its writes name by path.
    const writeTasks = new Map<string, Set<string>>()
    for (const r of this.out) {
      if (!r.writeTask || !this.sidechains.has(r.event.sessionId)) continue
      const set = writeTasks.get(r.event.sessionId) ?? new Set<string>()
      set.add(r.writeTask)
      writeTasks.set(r.event.sessionId, set)
    }
    return this.out.map(r => {
      if (r.branchTask)
        return { event: r.event, task: r.branchTask, via: 'branch' as const }
      if (r.pathTask)
        return { event: r.event, task: r.pathTask, via: 'path' as const }
      const tasks = writeTasks.get(r.event.sessionId)
      if (tasks?.size === 1)
        return {
          event: r.event,
          task: [...tasks][0]!,
          via: 'subagent' as const,
        }
      return { event: r.event, task: null, via: null }
    })
  }
}

/** Parse a whole transcript's entries (tests; small inputs). */
export function parseClaudeTranscript(
  entries: unknown[],
  attribution: RhAttribution = 'branch+path'
): AttributedRhEvent[] {
  const p = new ClaudeTranscriptParser(attribution)
  for (const e of entries) p.push(e)
  return p.finish()
}
