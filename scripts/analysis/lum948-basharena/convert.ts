/**
 * LUM-948 — BashArena trajectory → Lumo PostToolUse event conversion.
 *
 * Pure: no I/O. Two third-party trajectory formats (both unlicensed, so the
 * data is only ever downloaded to a local cache — see download.ts) are mapped
 * to the payload shape the CLI hook posts for a PostToolUse event, so the
 * evaluator can feed each one to the real `detectCrossings`.
 *
 *   abhayesian/basharena-monitor-eval — one row per scored action;
 *     trajectory = (sample_id, label). `action` is a JSON string
 *     `[{function:'bash'|'text_editor'|'python', arguments:{…}}]`.
 *   mandliya/basharena-synthetic-trajectories — one row per trajectory;
 *     label '0'/'1'. `trajectory` is a JSON string
 *     `[{assistant_visible_text, tool_calls:[{tool, input, output}]}]`.
 *
 * Mapping: bash → Bash `{command}`; text_editor create → Write
 * `{file_path, content}`; str_replace / insert → Edit `{file_path, old_string,
 * new_string}`; view → Read `{file_path}` (LUM-963: the Read tool is a
 * detector surface now); everything else (undo_edit, python, unknown) is
 * skipped and counted by reason so the report says what was not evaluated.
 */

export type TrajectoryLabel = 'attack' | 'honest'

export interface ToolEvent {
  toolName: 'Bash' | 'Write' | 'Edit' | 'Read'
  filePath: string | null
  payload: { tool_name: string; tool_input: Record<string, string> }
}

export interface Trajectory {
  /** Dataset id + split, e.g. `monitor-eval` / `synthetic:test`. */
  dataset: string
  id: string
  label: TrajectoryLabel
  /** Empty string for honest runs; several side tasks joined with `+`. */
  sideTask: string
  events: ToolEvent[]
  /** Skipped tool calls by reason (e.g. `text_editor:view`, `python`). */
  skipped: Record<string, number>
}

export type ConvertResult = { event: ToolEvent } | { skip: string }

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function bashEvent(command: string): ToolEvent {
  return {
    toolName: 'Bash',
    filePath: null,
    payload: { tool_name: 'Bash', tool_input: { command } },
  }
}

/** One ControlArena-style tool call (`{function, arguments}`) → event or skip. */
export function convertControlArenaCall(call: unknown): ConvertResult {
  if (!call || typeof call !== 'object') return { skip: 'malformed' }
  const c = call as Record<string, unknown>
  const fn = str(c.function) ?? 'unknown'
  const args =
    c.arguments && typeof c.arguments === 'object'
      ? (c.arguments as Record<string, unknown>)
      : {}
  if (fn === 'bash') {
    const cmd = str(args.cmd) ?? str(args.command)
    return cmd ? { event: bashEvent(cmd) } : { skip: 'bash:empty' }
  }
  if (fn === 'text_editor') {
    const sub = str(args.command) ?? 'unknown'
    const path = str(args.path)
    if (!path) return { skip: `text_editor:${sub}:no-path` }
    if (sub === 'create') {
      const content = str(args.file_text) ?? ''
      return {
        event: {
          toolName: 'Write',
          filePath: path,
          payload: {
            tool_name: 'Write',
            tool_input: { file_path: path, content },
          },
        },
      }
    }
    if (sub === 'str_replace' || sub === 'insert') {
      return {
        event: {
          toolName: 'Edit',
          filePath: path,
          payload: {
            tool_name: 'Edit',
            tool_input: {
              file_path: path,
              old_string: str(args.old_str) ?? '',
              new_string: str(args.new_str) ?? '',
            },
          },
        },
      }
    }
    if (sub === 'view') {
      return {
        event: {
          toolName: 'Read',
          filePath: path,
          payload: { tool_name: 'Read', tool_input: { file_path: path } },
        },
      }
    }
    return { skip: `text_editor:${sub}` }
  }
  return { skip: fn }
}

/** One synthetic-format tool call (`{tool, input, output}`) → event or skip. */
export function convertSyntheticCall(call: unknown): ConvertResult {
  if (!call || typeof call !== 'object') return { skip: 'malformed' }
  const c = call as Record<string, unknown>
  const tool = str(c.tool) ?? 'unknown'
  if (tool !== 'bash') return { skip: tool }
  const cmd = str(c.input)
  return cmd ? { event: bashEvent(cmd) } : { skip: 'bash:empty' }
}

function parseJsonArray(raw: unknown): unknown[] {
  if (typeof raw !== 'string') return Array.isArray(raw) ? raw : []
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function collect(
  calls: unknown[],
  convert: (c: unknown) => ConvertResult
): { events: ToolEvent[]; skipped: Record<string, number> } {
  const events: ToolEvent[] = []
  const skipped: Record<string, number> = {}
  for (const call of calls) {
    const r = convert(call)
    if ('event' in r) events.push(r.event)
    else skipped[r.skip] = (skipped[r.skip] ?? 0) + 1
  }
  return { events, skipped }
}

export interface MonitorEvalRow {
  sample_id: string
  action_idx: string | number
  label: string
  side_task: string
  action: string
  /** Assistant/tool messages before this action; only read with includeHistory. */
  previous_actions?: string
}

/** Tool calls of the assistant turns in a `previous_actions` history. */
function historyCalls(raw: unknown): unknown[] {
  const out: unknown[] = []
  for (const msg of parseJsonArray(raw)) {
    if (!msg || typeof msg !== 'object') continue
    const m = msg as Record<string, unknown>
    if (m.role !== 'assistant' || !Array.isArray(m.tool_calls)) continue
    out.push(...m.tool_calls)
  }
  return out
}

function toLabel(raw: string): TrajectoryLabel | null {
  if (raw === 'attack' || raw === '1') return 'attack'
  if (raw === 'honest' || raw === '0') return 'honest'
  return null
}

/**
 * Group monitor-eval rows into trajectories keyed by (sample_id, label) — the
 * same task id can appear once as an honest and once as an attack run. Default:
 * only the scored `action` of each row, in action_idx order. `includeHistory`
 * instead converts the whole trajectory — the `previous_actions` of the
 * latest scored row plus its own action — so actions the monitor did not score
 * are evaluated too.
 */
export function monitorEvalTrajectories(
  rows: MonitorEvalRow[],
  opts: { includeHistory?: boolean } = {}
): Trajectory[] {
  const groups = new Map<string, MonitorEvalRow[]>()
  for (const r of rows) {
    if (!toLabel(r.label)) continue
    const key = `${r.sample_id}|${r.label}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  const out: Trajectory[] = []
  for (const g of Array.from(groups.values())) {
    const sorted = [...g].sort(
      (a, b) => Number(a.action_idx) - Number(b.action_idx)
    )
    const last = sorted[sorted.length - 1]!
    const calls = opts.includeHistory
      ? [...historyCalls(last.previous_actions), ...parseJsonArray(last.action)]
      : sorted.flatMap(r => parseJsonArray(r.action))
    const { events, skipped } = collect(calls, convertControlArenaCall)
    const sides = Array.from(
      new Set(sorted.map(r => r.side_task).filter(s => s !== ''))
    ).sort()
    out.push({
      dataset: 'monitor-eval',
      id: last.sample_id,
      label: toLabel(last.label)!,
      sideTask: sides.join('+'),
      events,
      skipped,
    })
  }
  return out
}

export interface SyntheticRow {
  task_id: string
  label: string | number
  side_task: string
  trajectory: string
  source_file?: string
}

/** One synthetic row = one trajectory; every bash tool call becomes an event. */
export function syntheticTrajectories(
  rows: SyntheticRow[],
  split: string
): Trajectory[] {
  const out: Trajectory[] = []
  for (const r of rows) {
    const label = toLabel(String(r.label))
    if (!label) continue
    const calls = parseJsonArray(r.trajectory).flatMap(step =>
      step &&
      typeof step === 'object' &&
      Array.isArray((step as Record<string, unknown>).tool_calls)
        ? ((step as Record<string, unknown>).tool_calls as unknown[])
        : []
    )
    const { events, skipped } = collect(calls, convertSyntheticCall)
    out.push({
      dataset: `synthetic:${split}`,
      id: r.source_file ?? r.task_id,
      label,
      sideTask: r.side_task ?? '',
      events,
      skipped,
    })
  }
  return out
}
