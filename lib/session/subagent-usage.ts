import type { ModelUsage } from '@/lib/repositories/session.repository'
import { AGENT_ID_RE } from '@/lib/session/child-session-id'

/**
 * Cumulative transcript usage the CLI folds into STOP / STOP_FAILURE /
 * POST_TOOL_BATCH bodies under `_lumo_usage`. Since LUM-932 the CLI also sends
 * `bySubagent` (one cumulative entry per `subagents/agent-<id>.jsonl`); the
 * top-level totals still INCLUDE the subagents, so an older server that
 * ignores `bySubagent` keeps today's behavior.
 */
export interface InjectedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  byModel: Record<string, ModelUsage>
  bySubagent?: Record<string, InjectedUsage>
}

const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0

function parseUsageObject(u: unknown): InjectedUsage | null {
  if (!u || typeof u !== 'object') return null
  const o = u as Record<string, unknown>
  const byModel: Record<string, ModelUsage> = {}
  const raw = o['byModel']
  if (raw && typeof raw === 'object') {
    for (const [model, mv] of Object.entries(raw as Record<string, unknown>)) {
      if (!mv || typeof mv !== 'object') continue
      const mm = mv as Record<string, unknown>
      byModel[model] = {
        input: num(mm['input']),
        output: num(mm['output']),
        cacheRead: num(mm['cacheRead']),
        cacheCreation: num(mm['cacheCreation']),
      }
    }
  }
  return {
    inputTokens: num(o['inputTokens']),
    outputTokens: num(o['outputTokens']),
    cacheReadTokens: num(o['cacheReadTokens']),
    cacheCreationTokens: num(o['cacheCreationTokens']),
    byModel,
  }
}

export function parseInjectedUsage(payload: unknown): InjectedUsage | null {
  if (!payload || typeof payload !== 'object') return null
  const top = parseUsageObject(
    (payload as Record<string, unknown>)['_lumo_usage']
  )
  if (!top) return null
  const rawSubs = (
    (payload as Record<string, unknown>)['_lumo_usage'] as Record<
      string,
      unknown
    >
  )['bySubagent']
  if (rawSubs && typeof rawSubs === 'object') {
    const subs: Record<string, InjectedUsage> = {}
    for (const [agentId, v] of Object.entries(
      rawSubs as Record<string, unknown>
    )) {
      if (!AGENT_ID_RE.test(agentId)) continue
      const parsed = parseUsageObject(v)
      if (parsed) subs[agentId] = parsed
    }
    top.bySubagent = subs
  }
  return top
}

export function usageTotal(u: InjectedUsage): number {
  return (
    u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheCreationTokens
  )
}

const clamp = (n: number) => Math.max(0, n)

/** Parent's own usage = total − Σ subagents (clamped per field and per model). */
export function splitSubagentUsage(usage: InjectedUsage): {
  main: InjectedUsage
  bySubagent: Record<string, InjectedUsage>
} {
  const subs = usage.bySubagent ?? {}
  const entries = Object.values(subs)
  if (entries.length === 0) {
    const inputTokens = usage.inputTokens
    const outputTokens = usage.outputTokens
    const cacheReadTokens = usage.cacheReadTokens
    const cacheCreationTokens = usage.cacheCreationTokens
    const byModel = usage.byModel
    return {
      main: {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        byModel,
      },
      bySubagent: {},
    }
  }
  const byModel: Record<string, ModelUsage> = {}
  for (const [model, t] of Object.entries(usage.byModel)) {
    let input = t.input
    let output = t.output
    let cacheRead = t.cacheRead
    let cacheCreation = t.cacheCreation
    for (const s of entries) {
      const sm = s.byModel[model]
      if (!sm) continue
      input -= sm.input
      output -= sm.output
      cacheRead -= sm.cacheRead
      cacheCreation -= sm.cacheCreation
    }
    byModel[model] = {
      input: clamp(input),
      output: clamp(output),
      cacheRead: clamp(cacheRead),
      cacheCreation: clamp(cacheCreation),
    }
  }
  const sum = (k: keyof Omit<InjectedUsage, 'byModel' | 'bySubagent'>) =>
    clamp(usage[k] - entries.reduce((s, e) => s + e[k], 0))
  return {
    main: {
      inputTokens: sum('inputTokens'),
      outputTokens: sum('outputTokens'),
      cacheReadTokens: sum('cacheReadTokens'),
      cacheCreationTokens: sum('cacheCreationTokens'),
      byModel,
    },
    bySubagent: subs,
  }
}
