import type { ModelUsage } from '@/lib/services/model-cost'
import {
  BASH_CATEGORY_LABEL,
  isBashCategory,
} from '@/lib/agent-run/bash-category'

/** Bucket label for token spent on model steps that ran no tool (the final
 * wrap-up generation + pure-thinking turns). */
export const THINKING_BUCKET = '(thinking / no tool)'

export interface OperationCostEvent {
  sessionId: string | null
  workspaceMemberId: string | null
  /** HookEventType as a string (avoids importing the Prisma enum into a pure module). */
  type: string
  toolName: string | null
  /** LUM-840: Bash purpose slug from `HookEvent.toolDetail`; null/absent → plain tool name. */
  toolDetail?: string | null
  /** LUM-840: the command behind `toolDetail` (`HookEvent.toolVerb`), for the per-command drill-down. */
  toolVerb?: string | null
  /** Per-step delta on POST_TOOL_BATCH; per-turn delta on STOP/STOP_FAILURE; null on history. */
  usageByModel: Record<string, ModelUsage> | null
  createdAt: Date
}

export interface OperationCostRow {
  tool: string
  /** LUM-840: the command within a `Bash · <purpose>` row; null for other tools and unlabelled history. */
  verb: string | null
  model: string
  sessionId: string | null
  workspaceMemberId: string | null
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface OperationCostCoverage {
  /** Turns that used >= 1 tool. */
  toolTurns: number
  /** Of `toolTurns`, those that had >= 1 batch delta (per-step granularity). */
  perStepTurns: number
}

export interface OperationAttribution {
  rows: OperationCostRow[]
  coverage: OperationCostCoverage
}

/**
 * The row label an invocation is billed to: `Bash · <purpose>` when the event
 * carries a known Bash category (LUM-840), else the bare tool name — so rows
 * recorded before the column existed (and not yet backfilled) stay `Bash`.
 */
export function operationLabel(
  toolName: string,
  toolDetail: string | null | undefined
): string {
  if (toolName === 'Bash' && isBashCategory(toolDetail)) {
    return `Bash · ${BASH_CATEGORY_LABEL[toolDetail]}`
  }
  return toolName
}

const TOOL_TYPES = new Set(['POST_TOOL_USE', 'POST_TOOL_USE_FAILURE'])
// SUBAGENT_STOP closes a child session's "turn" (LUM-932): subagents emit no
// STOP, and their settled usage delta lives on their SUBAGENT_STOP row.
const STOP_TYPES = new Set(['STOP', 'STOP_FAILURE', 'SUBAGENT_STOP'])

type Acc = Map<string, OperationCostRow>

/** One tool invocation a step's tokens are split across. */
interface Invocation {
  tool: string
  verb: string | null
}

const THINKING_INVOCATION: Invocation = { tool: THINKING_BUCKET, verb: null }

function addToAcc(
  acc: Acc,
  { tool, verb }: Invocation,
  model: string,
  sessionId: string | null,
  memberId: string | null,
  u: ModelUsage
): void {
  const key = `${tool} ${verb ?? ''} ${model} ${sessionId ?? ''}`
  const cur = acc.get(key) ?? {
    tool,
    verb,
    model,
    sessionId,
    workspaceMemberId: memberId,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheCreation: 0,
  }
  cur.input += u.input
  cur.output += u.output
  cur.cacheRead += u.cacheRead
  cur.cacheCreation += u.cacheCreation
  acc.set(key, cur)
}

/** Attribute one per-model delta to a list of tool invocations (even split). */
function attributeDelta(
  delta: Record<string, ModelUsage>,
  invocations: Invocation[],
  sessionId: string | null,
  memberId: string | null,
  acc: Acc
): void {
  const targets = invocations.length ? invocations : [THINKING_INVOCATION]
  const n = targets.length
  for (const [model, u] of Object.entries(delta)) {
    for (const invocation of targets) {
      addToAcc(acc, invocation, model, sessionId, memberId, {
        input: u.input / n,
        output: u.output / n,
        cacheRead: u.cacheRead / n,
        cacheCreation: u.cacheCreation / n,
      })
    }
  }
}

/** per-model per-kind (a - b), clamped >= 0. Models only in `a` keep full value. */
function subtractClamp(
  a: Record<string, ModelUsage>,
  b: Record<string, ModelUsage>
): Record<string, ModelUsage> {
  const out: Record<string, ModelUsage> = {}
  for (const [model, av] of Object.entries(a)) {
    const bv = b[model]
    out[model] = {
      input: Math.max(0, av.input - (bv?.input ?? 0)),
      output: Math.max(0, av.output - (bv?.output ?? 0)),
      cacheRead: Math.max(0, av.cacheRead - (bv?.cacheRead ?? 0)),
      cacheCreation: Math.max(0, av.cacheCreation - (bv?.cacheCreation ?? 0)),
    }
  }
  return out
}

function addInto(
  target: Record<string, ModelUsage>,
  src: Record<string, ModelUsage>
): void {
  for (const [model, u] of Object.entries(src)) {
    const cur = target[model] ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    }
    cur.input += u.input
    cur.output += u.output
    cur.cacheRead += u.cacheRead
    cur.cacheCreation += u.cacheCreation
    target[model] = cur
  }
}

/**
 * Attribute each turn's token cost to the tools that ran in it, at per-step
 * (batch) granularity where available, per-turn otherwise. Pure + deterministic.
 *
 * Reconciliation guarantee: for every turn, the sum of attributed tokens equals
 * the STOP per-turn delta (the residual `(thinking/no tool)` bucket absorbs the
 * difference). So the grand total matches the existing per-turn token panel.
 */
export function attributeOperationCost(
  events: OperationCostEvent[]
): OperationAttribution {
  const acc: Acc = new Map()
  let toolTurns = 0
  let perStepTurns = 0

  const bySession = new Map<string, OperationCostEvent[]>()
  for (const e of events) {
    const k = e.sessionId ?? ''
    const list = bySession.get(k) ?? []
    list.push(e)
    bySession.set(k, list)
  }

  for (const list of bySession.values()) {
    const ordered = [...list].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    )
    let pendingTools: Invocation[] = []
    let turnBatchSum: Record<string, ModelUsage> = {}
    let turnHadTool = false
    let turnHadBatch = false
    const memberId = ordered[0]?.workspaceMemberId ?? null
    const sessionId = ordered[0]?.sessionId ?? null

    for (const e of ordered) {
      if (TOOL_TYPES.has(e.type)) {
        if (e.toolName) {
          const tool = operationLabel(e.toolName, e.toolDetail)
          pendingTools.push({
            tool,
            // Only a split Bash row drills down by command.
            verb: tool !== e.toolName ? (e.toolVerb ?? null) : null,
          })
          turnHadTool = true
        }
        continue
      }
      if (e.type === 'POST_TOOL_BATCH') {
        if (e.usageByModel) {
          attributeDelta(e.usageByModel, pendingTools, sessionId, memberId, acc)
          addInto(turnBatchSum, e.usageByModel)
          turnHadBatch = true
        }
        pendingTools = []
        continue
      }
      if (STOP_TYPES.has(e.type)) {
        const perTurn = e.usageByModel ?? {}
        const residual = subtractClamp(perTurn, turnBatchSum)
        attributeDelta(residual, pendingTools, sessionId, memberId, acc)
        if (turnHadTool) toolTurns += 1
        if (turnHadTool && turnHadBatch) perStepTurns += 1
        pendingTools = []
        turnBatchSum = {}
        turnHadTool = false
        turnHadBatch = false
      }
    }
  }

  return { rows: [...acc.values()], coverage: { toolTurns, perStepTurns } }
}
