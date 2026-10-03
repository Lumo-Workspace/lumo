import { readFileSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** Per-model token usage. Short keys match the ModelCost wire type. */
export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface TranscriptUsage {
  /** Flat cumulative total across all (non-synthetic) models — INCLUDES subagents. */
  total: SessionUsage
  /** Cumulative usage keyed by raw model string — INCLUDES subagents. */
  byModel: Record<string, ModelUsage>
  /** LUM-932: per-subagent cumulative usage keyed by agent id (from `agent-<id>.jsonl`). */
  bySubagent: Record<
    string,
    { total: SessionUsage; byModel: Record<string, ModelUsage> }
  >
}

/** Agent ids the server accepts as `bySubagent` keys. */
const AGENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Sum `message.usage` across all (non-synthetic) assistant messages of one
 * transcript JSONL file into the shared accumulators. Returns true if at
 * least one real usage entry was seen. Never throws.
 *
 * LUM-932: Claude Code writes ONE assistant message as several JSONL lines
 * (one per content block), each repeating the same `usage` under the same
 * `message.id`. Summing per line inflated usage ~2x, so each message id is
 * counted once (the last line seen for that id wins — identical in practice,
 * and the most complete if a later line ever carries grown output counts).
 * Lines without an id cannot be correlated and are each counted, as before.
 */
function accumulateFileUsage(
  path: string,
  total: SessionUsage,
  byModel: Record<string, ModelUsage>
): boolean {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return false
  }
  const byMessage = new Map<string, { model: string; usage: ModelUsage }>()
  let anonymous = 0
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    const o = obj as {
      type?: unknown
      message?: {
        id?: unknown
        model?: unknown
        usage?: Record<string, unknown>
      }
    }
    if (o.type !== 'assistant') continue
    const usage = o.message?.usage
    if (!usage) continue
    const model =
      typeof o.message?.model === 'string' && o.message.model.length > 0
        ? o.message.model
        : 'unknown'
    if (model === '<synthetic>') continue
    const id = o.message?.id
    const key =
      typeof id === 'string' && id.length > 0
        ? `id:${id}`
        : `line:${anonymous++}`
    byMessage.set(key, {
      model,
      usage: {
        input: asNumber(usage.input_tokens),
        output: asNumber(usage.output_tokens),
        cacheRead: asNumber(usage.cache_read_input_tokens),
        cacheCreation: asNumber(usage.cache_creation_input_tokens),
      },
    })
  }
  for (const { model, usage } of byMessage.values()) {
    total.inputTokens += usage.input
    total.outputTokens += usage.output
    total.cacheReadTokens += usage.cacheRead
    total.cacheCreationTokens += usage.cacheCreation
    const m = byModel[model] ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    }
    m.input += usage.input
    m.output += usage.output
    m.cacheRead += usage.cacheRead
    m.cacheCreation += usage.cacheCreation
    byModel[model] = m
  }
  return byMessage.size > 0
}

/**
 * Subagent (Task tool) turns are NOT in the main transcript — Claude Code
 * writes them to sibling files at `<dir>/<sessionId>/subagents/agent-*.jsonl`.
 * Resolve those for a main transcript path. Best-effort: returns [] when the
 * directory is missing or unreadable. Never throws.
 */
function listSubagentTranscripts(transcriptPath: string): string[] {
  if (!transcriptPath.endsWith('.jsonl')) return []
  const subagentsDir = join(
    transcriptPath.slice(0, -'.jsonl'.length),
    'subagents'
  )
  try {
    return readdirSync(subagentsDir)
      .filter(name => name.startsWith('agent-') && name.endsWith('.jsonl'))
      .map(name => join(subagentsDir, name))
  } catch {
    return []
  }
}

/**
 * Read a Claude Code transcript JSONL — plus any subagent transcripts under
 * `<dir>/<sessionId>/subagents/agent-*.jsonl` — and sum `message.usage`
 * across all (non-synthetic) assistant messages (deduped by `message.id`),
 * grouped by `message.model`
 * -> cumulative session totals. Entries with no model string bucket under
 * "unknown". Best-effort: returns null if nothing readable has real
 * assistant usage. Never throws.
 */
export function sumTranscriptUsage(
  transcriptPath: string
): TranscriptUsage | null {
  const byModel: Record<string, ModelUsage> = {}
  const total: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
  let seen = accumulateFileUsage(transcriptPath, total, byModel)
  const bySubagent: TranscriptUsage['bySubagent'] = {}
  for (const path of listSubagentTranscripts(transcriptPath)) {
    const subTotal: SessionUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    }
    const subByModel: Record<string, ModelUsage> = {}
    if (!accumulateFileUsage(path, subTotal, subByModel)) continue
    seen = true
    // Read twice on purpose: independent accumulators, subagent files are small.
    accumulateFileUsage(path, total, byModel)
    const agentId = basename(path).slice('agent-'.length, -'.jsonl'.length)
    // Skip ids the server would reject (it would drop the whole map).
    if (!AGENT_ID_RE.test(agentId)) continue
    bySubagent[agentId] = { total: subTotal, byModel: subByModel }
  }
  return seen ? { total, byModel, bySubagent } : null
}
