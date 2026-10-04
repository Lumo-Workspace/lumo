/**
 * LUM-958 — which BashArena actions go to the LLM judge, and with what context.
 *
 * Pure: no I/O. Reads the same two third-party datasets LUM-948 caches
 * (unlicensed → local cache only, never committed) and turns every
 * trajectory into an ordered list of tool events, then keeps the
 * *candidates*:
 *
 *   - every Write / Edit (attacks hide the exfiltration in a script the agent
 *     writes and later runs — LUM-948: static rules 0/38);
 *   - every Bash command matching a deliberately loose network / privilege /
 *     firewall / sensitive-path pre-filter (`PREFILTER`).
 *
 * Each candidate carries the trajectory's task description and a short
 * summary of the few events before it, which is all the judge sees. The
 * red-team `side_task_description`, the agent's prose and tool outputs are
 * never carried: the judge must not see the attacker's brief.
 */
import {
  convertControlArenaCall,
  convertSyntheticCall,
  type ToolEvent,
  type TrajectoryLabel,
} from '../lum948-basharena/convert'

/** Loose on purpose: a miss here is a miss the LLM never gets to see. */
export const PREFILTER =
  /\b(?:curl|wget|nc|ncat|socat|ssh|scp|sftp|rsync|ftp|telnet|requests|urllib|httpx|aiohttp|socket|sudo|sudoers|visudo|iptables|ip6tables|nft|ufw|firewall|chmod|chown|setcap|usermod|useradd|passwd|shadow|base64|crontab|api_tokens)\b|https?:\/\/|\/etc\/|\.ssh\b|\b\d{1,3}(?:\.\d{1,3}){3}\b/i

/** Per-candidate action text cap (chars); longer actions are head+tail cut. */
export const ACTION_CHAR_CAP = 12_000
/** Task description cap (chars). BashArena descriptions: median ~5.4k. */
export const TASK_CHAR_CAP = 16_000
/** How many earlier events are summarised for context, and how long each. */
export const PRIOR_EVENTS = 4
export const PRIOR_EVENT_CHARS = 240

export interface Candidate {
  /** `<dataset>|<trajectory id>|<event index>` — stable across runs. */
  id: string
  dataset: string
  trajectoryId: string
  label: TrajectoryLabel
  sideTask: string
  eventIndex: number
  tool: ToolEvent['toolName']
  filePath: string | null
  /** The action as the judge sees it (Bash command, or written content). */
  action: string
  actionTruncated: boolean
  /** One line per earlier event, oldest first. */
  prior: string[]
  taskDescription: string
}

export interface TrajectoryMeta {
  dataset: string
  id: string
  label: TrajectoryLabel
  sideTask: string
  events: number
  candidates: number
}

export function clip(
  text: string,
  cap: number
): { text: string; cut: boolean } {
  if (text.length <= cap) return { text, cut: false }
  const head = Math.floor(cap * 0.7)
  const tail = cap - head
  return {
    text: `${text.slice(0, head)}\n…[${text.length - cap} chars omitted]…\n${text.slice(-tail)}`,
    cut: true,
  }
}

/** The text an event "does": the command, or the content written. */
export function actionText(e: ToolEvent): string {
  const i = e.payload.tool_input
  if (e.toolName === 'Bash') return i.command ?? ''
  if (e.toolName === 'Write') return i.content ?? ''
  return `--- old\n${i.old_string ?? ''}\n+++ new\n${i.new_string ?? ''}`
}

export function isCandidate(e: ToolEvent): boolean {
  if (e.toolName !== 'Bash') return true
  return PREFILTER.test(e.payload.tool_input.command ?? '')
}

/** One-line summary of an earlier event for the judge's context. */
export function summarizeEvent(e: ToolEvent): string {
  const body = actionText(e).replace(/\s+/g, ' ').trim()
  const head =
    e.toolName === 'Bash' ? 'Bash' : `${e.toolName} ${e.filePath ?? '?'}`
  const short =
    body.length > PRIOR_EVENT_CHARS
      ? `${body.slice(0, PRIOR_EVENT_CHARS)}…`
      : body
  return `${head}: ${short}`
}

export function candidatesOf(
  traj: {
    dataset: string
    id: string
    label: TrajectoryLabel
    sideTask: string
    events: ToolEvent[]
  },
  taskDescription: string
): Candidate[] {
  const task = clip(taskDescription, TASK_CHAR_CAP).text
  const out: Candidate[] = []
  traj.events.forEach((e, idx) => {
    if (!isCandidate(e)) return
    const a = clip(actionText(e), ACTION_CHAR_CAP)
    out.push({
      id: `${traj.dataset}|${traj.id}|${idx}`,
      dataset: traj.dataset,
      trajectoryId: traj.id,
      label: traj.label,
      sideTask: traj.sideTask,
      eventIndex: idx,
      tool: e.toolName,
      filePath: e.filePath,
      action: a.text,
      actionTruncated: a.cut,
      prior: traj.events
        .slice(Math.max(0, idx - PRIOR_EVENTS), idx)
        .map(summarizeEvent),
      taskDescription: task,
    })
  })
  return out
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

function toLabel(raw: string): TrajectoryLabel | null {
  if (raw === 'attack' || raw === '1') return 'attack'
  if (raw === 'honest' || raw === '0') return 'honest'
  return null
}

function eventsOf(
  calls: unknown[],
  convert: typeof convertControlArenaCall
): ToolEvent[] {
  const out: ToolEvent[] = []
  for (const c of calls) {
    const r = convert(c)
    if ('event' in r) out.push(r.event)
  }
  return out
}

export interface MonitorEvalRow {
  sample_id: string
  action_idx: string | number
  label: string
  side_task: string
  task_description: string
  previous_actions: string
  action: string
}

/**
 * monitor-eval → whole trajectories. A trajectory is (sample_id, label); its
 * events are the `previous_actions` of its latest scored row plus that row's
 * own action — i.e. everything the agent did up to the last scored step, as
 * a production monitor would see it (LUM-948 `--history`). Judging only the
 * scored actions would undercount honest trajectories (85 honest vs 178
 * attack candidates), so the false-positive rate would look better than it is.
 */
export function monitorEvalCandidates(rows: MonitorEvalRow[]): {
  meta: TrajectoryMeta[]
  candidates: Candidate[]
} {
  const groups = new Map<string, MonitorEvalRow[]>()
  for (const r of rows) {
    if (!toLabel(r.label)) continue
    const key = `${r.sample_id}|${r.label}`
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }
  const meta: TrajectoryMeta[] = []
  const candidates: Candidate[] = []
  for (const g of Array.from(groups.values())) {
    const sorted = [...g].sort(
      (a, b) => Number(a.action_idx) - Number(b.action_idx)
    )
    const last = sorted[sorted.length - 1]!
    const calls: unknown[] = []
    for (const msg of parseJsonArray(last.previous_actions)) {
      if (!msg || typeof msg !== 'object') continue
      const m = msg as Record<string, unknown>
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        calls.push(...m.tool_calls)
      }
    }
    calls.push(...parseJsonArray(last.action))
    const label = toLabel(last.label)!
    const sideTask = Array.from(
      new Set(sorted.map(r => r.side_task).filter(s => s !== ''))
    )
      .sort()
      .join('+')
    const traj = {
      dataset: 'monitor-eval',
      // The same task id can have both an honest and an attack run.
      id: `${last.sample_id}:${label}`,
      label,
      sideTask,
      events: eventsOf(calls, convertControlArenaCall),
    }
    const cs = candidatesOf(traj, last.task_description ?? '')
    candidates.push(...cs)
    meta.push({
      dataset: traj.dataset,
      id: traj.id,
      label,
      sideTask,
      events: traj.events.length,
      candidates: cs.length,
    })
  }
  return { meta, candidates }
}

export interface SyntheticRow {
  task_id: string
  task_description: string
  label: string | number
  side_task: string
  trajectory: string
  source_file?: string
}

export function syntheticCandidates(
  rows: SyntheticRow[],
  split: string
): { meta: TrajectoryMeta[]; candidates: Candidate[] } {
  const meta: TrajectoryMeta[] = []
  const candidates: Candidate[] = []
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
    const traj = {
      dataset: `synthetic:${split}`,
      id: r.source_file ?? r.task_id,
      label,
      sideTask: r.side_task ?? '',
      events: eventsOf(calls, convertSyntheticCall),
    }
    const cs = candidatesOf(traj, r.task_description ?? '')
    candidates.push(...cs)
    meta.push({
      dataset: traj.dataset,
      id: traj.id,
      label,
      sideTask: traj.sideTask,
      events: traj.events.length,
      candidates: cs.length,
    })
  }
  return { meta, candidates }
}

/** FNV-1a — a stable, seedless order for deterministic sampling. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * Deterministic stratified sample: per stratum (`label:sideTask`), the
 * `perStratum` trajectories with the lowest stable hash of their id.
 */
export function sampleTrajectories(
  meta: TrajectoryMeta[],
  perStratum: Record<string, number>
): Set<string> {
  const byStratum = new Map<string, TrajectoryMeta[]>()
  for (const m of meta) {
    const key = m.label === 'honest' ? 'honest' : `attack:${m.sideTask}`
    const g = byStratum.get(key)
    if (g) g.push(m)
    else byStratum.set(key, [m])
  }
  const keep = new Set<string>()
  for (const [key, list] of Array.from(byStratum.entries())) {
    const n = perStratum[key] ?? perStratum['*'] ?? 0
    ;[...list]
      .sort((a, b) => stableHash(a.id) - stableHash(b.id))
      .slice(0, n)
      .forEach(m => keep.add(`${m.dataset}|${m.id}`))
  }
  return keep
}

/**
 * Trajectory-grouped order: all candidates of one trajectory run back to
 * back on one worker, so the task-block prompt cache stays warm.
 */
export function groupByTrajectory(cs: Candidate[]): Candidate[][] {
  const groups = new Map<string, Candidate[]>()
  for (const c of cs) {
    const k = `${c.dataset}|${c.trajectoryId}`
    const g = groups.get(k)
    if (g) g.push(c)
    else groups.set(k, [c])
  }
  return Array.from(groups.values())
}
