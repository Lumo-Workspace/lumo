/**
 * LUM-949 — convert R-Judge agent actions into Claude Code PostToolUse events.
 *
 * Pure. R-Judge mixes several action dialects; only the ones a coding agent
 * would emit as a Bash / Write / Read tool call are converted:
 *
 *   ToolEmu   `TerminalExecute: {"command": "…"}`          → Bash
 *   chat      ```bash … ``` fenced block (one event per block) → Bash
 *   AutoGPT   `"command": {"name": "<cmd>", "args": {…}}` (AgentMonitor):
 *               execute_shell / bare command string        → Bash
 *               execute_python_code {code}                 → Bash `python3 -c '<code>'`
 *               execute_python_file {filename}             → Bash `python3 <filename>`
 *               list_files {directory}                     → Bash `ls <directory>`
 *               write_to_file {filename, text}             → Write
 *               read_file {filename}                       → Read
 *
 * Everything else is skipped with a reason: a third-party API tool
 * (`GmailSendEmail: {…}`), a pseudo call (`OpenBrowser(url=…)`), a GUI step
 * (`click …`), a non-shell code block, or plain prose / a final answer.
 */

export type LumoToolName = 'Bash' | 'Write' | 'Read'

/** A PostToolUse-shaped event, ready for `detectCrossings`. */
export interface ToolEvent {
  toolName: LumoToolName
  filePath: string | null
  payload: { tool_input: Record<string, string> }
}

export type SkipReason =
  | 'no_action'
  | 'prose'
  | 'api_tool'
  | 'pseudo_call'
  | 'gui_action'
  | 'non_shell_code'
  | 'agentmonitor_unsupported'
  | 'unparseable'

export type ActionConversion =
  | { kind: 'mapped'; events: ToolEvent[] }
  | { kind: 'skipped'; reason: SkipReason; tool?: string }

/** Skip reasons that mean "the agent DID act, through a surface we can't see". */
export const UNSEEN_ACTION_REASONS: ReadonlySet<SkipReason> = new Set([
  'api_tool',
  'pseudo_call',
  'gui_action',
  'agentmonitor_unsupported',
  'unparseable',
])

/** POSIX single-quote a shell word. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function shWord(s: string): string {
  return /^[\w./~:@%+=,-]+$/.test(s) ? s : shQuote(s)
}

function bash(command: string): ToolEvent {
  return {
    toolName: 'Bash',
    filePath: null,
    payload: { tool_input: { command } },
  }
}

/**
 * Parse a JSON object out of a fragment that may carry leading text and extra
 * trailing braces (AgentMonitor rows are cut out of a larger object). Tries the
 * text from the first `{`, then drops trailing `}`/whitespace one at a time.
 */
export function parseLooseObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let body = text.slice(start).trimEnd()
  for (let i = 0; i < 12 && body.length > 1; i++) {
    try {
      const v: unknown = JSON.parse(body)
      return v !== null && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null
    } catch {
      body = body.replace(/\}\s*$/, '').trimEnd()
    }
  }
  return null
}

/** Pull `"command": "…"` out of JSON-ish text, tolerating broken JSON. */
function extractCommand(text: string): string | null {
  const obj = parseLooseObject(text)
  if (obj && typeof obj.command === 'string') return obj.command
  const m = text.match(/"command"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!m || m[1] === undefined) return null
  try {
    return JSON.parse(`"${m[1]}"`) as string
  } catch {
    return m[1]
  }
}

const AGENTMONITOR_NAMES =
  /^(write_to_file|read_file|list_files|execute_python_code|execute_python_file|execute_shell)\s*:/

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function convertAgentMonitor(
  name: string,
  args: Record<string, unknown>
): ActionConversion {
  switch (name) {
    case 'execute_shell': {
      const cmd = str(args.command_line) ?? str(args.command)
      return cmd
        ? { kind: 'mapped', events: [bash(cmd)] }
        : { kind: 'skipped', reason: 'unparseable', tool: name }
    }
    case 'execute_python_code': {
      const code = str(args.code)
      return code
        ? { kind: 'mapped', events: [bash(`python3 -c ${shQuote(code)}`)] }
        : { kind: 'skipped', reason: 'unparseable', tool: name }
    }
    case 'execute_python_file': {
      const f = str(args.filename)
      return f
        ? { kind: 'mapped', events: [bash(`python3 ${shWord(f)}`)] }
        : { kind: 'skipped', reason: 'unparseable', tool: name }
    }
    case 'list_files': {
      const d = str(args.directory)
      return d
        ? { kind: 'mapped', events: [bash(`ls ${shWord(d)}`)] }
        : { kind: 'skipped', reason: 'unparseable', tool: name }
    }
    case 'write_to_file': {
      const f = str(args.filename)
      const text = typeof args.text === 'string' ? args.text : null
      return f && text !== null
        ? {
            kind: 'mapped',
            events: [
              {
                toolName: 'Write',
                filePath: f,
                payload: { tool_input: { file_path: f, content: text } },
              },
            ],
          }
        : { kind: 'skipped', reason: 'unparseable', tool: name }
    }
    case 'read_file': {
      const f = str(args.filename)
      return f
        ? {
            kind: 'mapped',
            events: [
              {
                toolName: 'Read',
                filePath: f,
                payload: { tool_input: { file_path: f } },
              },
            ],
          }
        : { kind: 'skipped', reason: 'unparseable', tool: name }
    }
    default:
      return { kind: 'skipped', reason: 'agentmonitor_unsupported', tool: name }
  }
}

const SHELL_FENCE = /^(?:bash|sh|shell|zsh|console)$/i
const FENCE = /```([A-Za-z0-9_+-]*)[ \t]*\n?([\s\S]*?)```/g
const API_TOOL = /^\{?"?([A-Z][A-Za-z0-9]+)"?(?:\s+Input)?\s*:\s*[[{"]/
/** ReAct scaffolding labels that look like `Tool: {…}` but are narration. */
const NOT_A_TOOL: ReadonlySet<string> = new Set([
  'Output',
  'Observation',
  'Thought',
  'Answer',
  'Action',
])
const PSEUDO_CALL = /^[A-Za-z_][A-Za-z0-9_]*\([\s\S]*\)\s*$/
const GUI_VERB = /^(?:click|tap|swipe|scroll|press|type|open|delete)\b/i

/** Convert one R-Judge agent `action` value. */
export function convertAction(action: unknown): ActionConversion {
  if (action === null || action === undefined) {
    return { kind: 'skipped', reason: 'no_action' }
  }
  const raw = typeof action === 'string' ? action : JSON.stringify(action)
  const s = raw.trim()
  if (s.length === 0) return { kind: 'skipped', reason: 'no_action' }

  // ToolEmu terminal tool.
  if (/^TerminalExecute(?:\s+Input)?\s*:/.test(s)) {
    const cmd = extractCommand(s)
    return cmd
      ? { kind: 'mapped', events: [bash(cmd)] }
      : { kind: 'skipped', reason: 'unparseable', tool: 'TerminalExecute' }
  }

  // AgentMonitor (AutoGPT command dialect).
  const named = s.match(AGENTMONITOR_NAMES)
  if (named?.[1]) {
    const args = parseLooseObject(s)
    return args
      ? convertAgentMonitor(named[1], args)
      : { kind: 'skipped', reason: 'unparseable', tool: named[1] }
  }
  if (/^"command"\s*:/.test(s)) {
    const obj = parseLooseObject(`{${s}`)
    const command = obj?.command
    if (typeof command === 'string') {
      return { kind: 'mapped', events: [bash(command)] }
    }
    if (command && typeof command === 'object') {
      const c = command as Record<string, unknown>
      const name = typeof c.name === 'string' ? c.name : ''
      const args =
        c.args && typeof c.args === 'object'
          ? (c.args as Record<string, unknown>)
          : {}
      return convertAgentMonitor(name, args)
    }
    return { kind: 'skipped', reason: 'unparseable', tool: 'agentmonitor' }
  }

  // Fenced code blocks.
  const fences = [...s.matchAll(FENCE)]
  if (fences.length > 0) {
    const events = fences
      .filter(f => SHELL_FENCE.test(f[1] ?? ''))
      .map(f => (f[2] ?? '').trim())
      .filter(cmd => cmd.length > 0)
      .map(bash)
    return events.length > 0
      ? { kind: 'mapped', events }
      : { kind: 'skipped', reason: 'non_shell_code' }
  }

  const api = s.match(API_TOOL)
  if (api?.[1] && !NOT_A_TOOL.has(api[1]))
    return { kind: 'skipped', reason: 'api_tool', tool: api[1] }
  if (PSEUDO_CALL.test(s)) {
    return {
      kind: 'skipped',
      reason: 'pseudo_call',
      tool: s.slice(0, s.indexOf('(')),
    }
  }
  if (GUI_VERB.test(s) && s.length < 120) {
    return { kind: 'skipped', reason: 'gui_action' }
  }
  return { kind: 'skipped', reason: 'prose' }
}

export interface ConvertedRecord<R> {
  record: R
  events: ToolEvent[]
  skipped: { reason: SkipReason; tool?: string }[]
  /**
   * mapped   — ≥1 event and every agent action we skipped was prose/no-op;
   * partial  — ≥1 event, but the agent also acted through an unseen surface
   *            (an API tool, a GUI step …) where the risk may actually live;
   * unmapped — no event at all.
   */
  status: 'mapped' | 'partial' | 'unmapped'
}

/** Convert every agent action of a record (all turns, in order). */
export function convertRecord<
  R extends { contents: { role: string; action?: unknown }[][] },
>(record: R): ConvertedRecord<R> {
  const events: ToolEvent[] = []
  const skipped: { reason: SkipReason; tool?: string }[] = []
  for (const turn of record.contents) {
    for (const msg of turn) {
      if (msg.role !== 'agent') continue
      const c = convertAction(msg.action)
      if (c.kind === 'mapped') events.push(...c.events)
      else
        skipped.push(
          c.tool ? { reason: c.reason, tool: c.tool } : { reason: c.reason }
        )
    }
  }
  const unseen = skipped.some(s => UNSEEN_ACTION_REASONS.has(s.reason))
  const status =
    events.length === 0 ? 'unmapped' : unseen ? 'partial' : 'mapped'
  return { record, events, skipped, status }
}
