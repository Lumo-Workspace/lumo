import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ModelUsage,
  SessionUsage,
  TranscriptUsage,
} from './transcript-usage'

/**
 * LUM-1051 — token usage of a Codex session, read from its rollout file
 * (`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread id>.jsonl`, the hook
 * payload's `transcript_path`). Same shape as the Claude transcript reader so
 * the hook folds it into `_lumo_usage` unchanged.
 *
 * Each model response writes one `token_usage_record` line (keyed by
 * `response_id`) with that response's `usage`; the model comes from the
 * latest `turn_context` line. OpenAI counts cached input INSIDE
 * `input_tokens` (Anthropic does not), so input = input − cached, and
 * cacheRead = cached. Reasoning tokens are already inside `output_tokens`.
 *
 * A subagent writes its own rollout; the parent rollout names it in a
 * `SubAgentActivity` item (`agent_thread_id`). Those files are summed into
 * `bySubagent`, keyed by thread id — the hook's `agent_id`, so the server
 * settles them onto the same `<sid>:<agentId>` child sessions.
 */

const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function emptyTotal(): SessionUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
}

interface RolloutRead {
  seen: boolean
  subagentThreadIds: string[]
}

function accumulateRollout(
  path: string,
  total: SessionUsage,
  byModel: Record<string, ModelUsage>
): RolloutRead {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { seen: false, subagentThreadIds: [] }
  }
  let model = 'unknown'
  // The rollout's own thread: the FIRST session_meta.id. A forked subagent's
  // rollout (`forked_from_id`) also carries a copy of the parent's
  // session_meta after its own, which must not take over. Usage records of
  // any other thread are skipped so a subagent's usage can never count twice.
  let ownThread: string | null = null
  const byResponse = new Map<string, { model: string; usage: ModelUsage }>()
  const subagents = new Set<string>()
  let anonymous = 0
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    let line: { type?: unknown; payload?: Record<string, unknown> }
    try {
      line = JSON.parse(raw)
    } catch {
      continue
    }
    const p = line.payload
    if (!p || typeof p !== 'object') continue
    if (line.type === 'session_meta') {
      if (ownThread === null && typeof p.id === 'string' && p.id)
        ownThread = p.id
      continue
    }
    if (line.type === 'turn_context') {
      if (typeof p.model === 'string' && p.model) model = p.model
      continue
    }
    if (line.type === 'event_msg') {
      const item = p.item as Record<string, unknown> | undefined
      const thread = item?.agent_thread_id
      if (
        item?.type === 'SubAgentActivity' &&
        typeof thread === 'string' &&
        AGENT_ID_RE.test(thread)
      ) {
        subagents.add(thread)
      }
      continue
    }
    if (line.type !== 'token_usage_record') continue
    if (
      ownThread !== null &&
      typeof p.thread_id === 'string' &&
      p.thread_id !== ownThread
    )
      continue
    const u = p.usage as Record<string, unknown> | undefined
    if (!u || typeof u !== 'object') continue
    const input = num(u.input_tokens)
    const cached = Math.min(num(u.cached_input_tokens), input)
    const id = p.response_id
    const key =
      typeof id === 'string' && id ? `id:${id}` : `line:${anonymous++}`
    byResponse.set(key, {
      model,
      usage: {
        input: input - cached,
        output: num(u.output_tokens),
        cacheRead: cached,
        cacheCreation: num(u.cache_write_input_tokens),
      },
    })
  }
  for (const { model: m, usage } of byResponse.values()) {
    total.inputTokens += usage.input
    total.outputTokens += usage.output
    total.cacheReadTokens += usage.cacheRead
    total.cacheCreationTokens += usage.cacheCreation
    const acc = byModel[m] ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    }
    acc.input += usage.input
    acc.output += usage.output
    acc.cacheRead += usage.cacheRead
    acc.cacheCreation += usage.cacheCreation
    byModel[m] = acc
  }
  return { seen: byResponse.size > 0, subagentThreadIds: [...subagents] }
}

/**
 * Find a subagent's rollout: same day directory as the parent first, then any
 * day directory under the sessions root (a subagent spawned after midnight).
 */
export function findSubagentRollout(
  parentRollout: string,
  threadId: string
): string | null {
  const suffix = `-${threadId}.jsonl`
  const match = (dir: string): string | null => {
    try {
      const hit = readdirSync(dir).find(
        n => n.startsWith('rollout-') && n.endsWith(suffix)
      )
      return hit ? join(dir, hit) : null
    } catch {
      return null
    }
  }
  const dayDir = dirname(parentRollout)
  const sameDay = match(dayDir)
  if (sameDay) return sameDay
  const root = dirname(dirname(dirname(dayDir)))
  const listDirs = (dir: string): string[] => {
    try {
      return readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => join(dir, e.name))
    } catch {
      return []
    }
  }
  for (const year of listDirs(root).sort().reverse()) {
    for (const month of listDirs(year).sort().reverse()) {
      for (const day of listDirs(month).sort().reverse()) {
        if (day === dayDir) continue
        const hit = match(day)
        if (hit) return hit
      }
    }
  }
  return null
}

/**
 * Cumulative usage of a Codex session: its own rollout plus every subagent
 * rollout it names. Totals INCLUDE subagents (as the Claude reader's do);
 * `bySubagent` lets the server split them out. Null when nothing readable
 * carries usage. Never throws.
 */
export function sumCodexRolloutUsage(
  rolloutPath: string
): TranscriptUsage | null {
  const total = emptyTotal()
  const byModel: Record<string, ModelUsage> = {}
  const main = accumulateRollout(rolloutPath, total, byModel)
  let seen = main.seen
  const bySubagent: TranscriptUsage['bySubagent'] = {}
  for (const thread of main.subagentThreadIds) {
    const path = findSubagentRollout(rolloutPath, thread)
    if (!path) continue
    const subTotal = emptyTotal()
    const subByModel: Record<string, ModelUsage> = {}
    if (!accumulateRollout(path, subTotal, subByModel).seen) continue
    seen = true
    accumulateRollout(path, total, byModel)
    bySubagent[thread] = { total: subTotal, byModel: subByModel }
  }
  return seen ? { total, byModel, bySubagent } : null
}
