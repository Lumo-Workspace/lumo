import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  attributeOperationCost,
  type OperationCostRow,
} from '@/lib/agent-run/operation-cost'
import type { ModelUsage } from '@/lib/services/model-cost'
import { parseChildSessionId } from '@/lib/session/child-session-id'
import type {
  OperationCostResponse,
  OperationCostRowDto,
} from '@/types/operation-cost'

const DEFAULT_WINDOW_DAYS = 30

/** Group attribution rows by a key, resolve a label, sort by total desc. */
export function foldRows(
  rows: OperationCostRow[],
  keyOf: (r: OperationCostRow) => string,
  labelOf: (key: string) => string | undefined
): OperationCostRowDto[] {
  const acc = new Map<string, OperationCostRowDto>()
  for (const r of rows) {
    const key = keyOf(r)
    const cur = acc.get(key) ?? {
      key,
      label: key,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
      total: 0,
    }
    cur.input += r.input
    cur.output += r.output
    cur.cacheRead += r.cacheRead
    cur.cacheCreation += r.cacheCreation
    cur.total += r.input + r.output + r.cacheRead + r.cacheCreation
    acc.set(key, cur)
  }
  const out = [...acc.values()]
  for (const r of out) {
    roundRow(r)
    const label = labelOf(r.key)
    if (label) r.label = label
  }
  return out.sort((a, b) => b.total - a.total)
}

/**
 * LUM-1124: attributed rows carry fractional shares (a parallel-tool step is
 * split evenly), so a fold ends in float noise (10227.999999999998). Round
 * each part once and rebuild the total from the whole parts so it adds up.
 */
export function roundRow<
  T extends {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    total: number
  },
>(t: T): T {
  t.input = Math.round(t.input)
  t.output = Math.round(t.output)
  t.cacheRead = Math.round(t.cacheRead)
  t.cacheCreation = Math.round(t.cacheCreation)
  t.total = t.input + t.output + t.cacheRead + t.cacheCreation
  return t
}

const SESSION_PREFIX_MIN = 8

/**
 * LUM-1124: short, distinct labels for the By-session table. A subagent's
 * session is `<parent>:<agentId>`, so cutting the whole id to 8 chars turned
 * every child into its parent's prefix. Label a child `<parent>:<agent>`,
 * each cut to the same prefix length, and grow that length until no two
 * labels collide. The full id stays in the row's `key`.
 */
export function sessionLabels(keys: string[]): Map<string, string> {
  const parts = keys.map(k => {
    const child = parseChildSessionId(k)
    return child
      ? { key: k, root: child.parentSessionId, agent: child.agentId }
      : { key: k, root: k, agent: null }
  })
  const longest = parts.reduce(
    (m, p) => Math.max(m, p.root.length, p.agent?.length ?? 0),
    SESSION_PREFIX_MIN
  )
  for (let n = SESSION_PREFIX_MIN; ; n++) {
    const labels = new Map(
      parts.map(p => [
        p.key,
        p.agent === null
          ? p.root.slice(0, n)
          : `${p.root.slice(0, n)}:${p.agent.slice(0, n)}`,
      ])
    )
    if (new Set(labels.values()).size === labels.size || n >= longest)
      return labels
  }
}

/** Label for Bash tokens recorded before `toolVerb` existed (not yet backfilled). */
export const UNLABELLED_COMMAND = '(unlabelled)'

/**
 * LUM-840: attach a per-command breakdown to each tool row whose invocations
 * carry a command (the `Bash · <purpose>` rows). Sums to its parent row.
 */
export function withCommandBreakdown(
  rows: OperationCostRow[],
  byTool: OperationCostRowDto[]
): OperationCostRowDto[] {
  const byParent = new Map<string, OperationCostRow[]>()
  for (const r of rows) {
    const list = byParent.get(r.tool) ?? []
    list.push(r)
    byParent.set(r.tool, list)
  }
  return byTool.map(row => {
    const children = byParent.get(row.key) ?? []
    if (!children.some(r => r.verb !== null)) return row
    const breakdown = foldRows(
      children,
      r => r.verb ?? UNLABELLED_COMMAND,
      () => undefined
    )
    // Each child is whole tokens on its own, so rebuild the parent from them —
    // rounding the two independently could leave them a token apart.
    const sum = { ...row, input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
    for (const c of breakdown) {
      sum.input += c.input
      sum.output += c.output
      sum.cacheRead += c.cacheRead
      sum.cacheCreation += c.cacheCreation
    }
    sum.total = sum.input + sum.output + sum.cacheRead + sum.cacheCreation
    return { ...sum, breakdown }
  })
}

export type OperationCostScope =
  | { kind: 'task'; identifier: string }
  | { kind: 'session'; sessionId: string }
  | { kind: 'workspace'; since?: Date }

export const operationCostService = {
  async getOperationCost(
    workspaceId: string,
    scope: OperationCostScope
  ): Promise<OperationCostResponse | null> {
    let events
    let scopeLabel = ''
    const scopeKind: 'task' | 'session' | 'workspace' = scope.kind

    if (scope.kind === 'task') {
      const { taskService } = await import('@/lib/services/task.service')
      const resolved = await taskService.resolveIdentifier(
        workspaceId,
        scope.identifier
      )
      if (!resolved) return null
      events = await hookEventRepository.findToolAttributionEvents({
        taskId: resolved.id,
      })
      scopeLabel = scope.identifier
    } else if (scope.kind === 'session') {
      events = await hookEventRepository.findToolAttributionEvents({
        sessionId: scope.sessionId,
        workspaceId,
      })
      scopeLabel = scope.sessionId
    } else {
      const since =
        scope.since ??
        new Date(Date.now() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000)
      events = await hookEventRepository.findToolAttributionEvents({
        workspaceId,
        since,
      })
      scopeLabel = scope.since
        ? `since ${scope.since.toISOString()}`
        : `last ${DEFAULT_WINDOW_DAYS}d`
    }

    const { rows, coverage } = attributeOperationCost(
      events.map(e => ({
        sessionId: e.sessionId,
        workspaceMemberId: e.workspaceMemberId,
        type: e.type,
        toolName: e.toolName,
        toolDetail: e.toolDetail,
        toolVerb: e.toolVerb,
        usageByModel: e.usageByModel as Record<string, ModelUsage> | null,
        createdAt: e.createdAt,
      }))
    )

    const memberIds = [
      ...new Set(
        rows.map(r => r.workspaceMemberId).filter((x): x is string => !!x)
      ),
    ]
    const memberLabels = await memberRepository.labelsByIds(memberIds)
    const sessionKey = (r: OperationCostRow) => r.sessionId ?? '(none)'
    const sessionLabel = sessionLabels([...new Set(rows.map(sessionKey))])

    // Same rounding grain as `lumo report` (LUM-1123): whole tokens per
    // member × model cell, summed — so the two agree to the token.
    const grand = foldRows(
      rows,
      r => `${r.workspaceMemberId ?? ''}\u0000${r.model}`,
      () => undefined
    ).reduce(
      (t, c) => {
        t.input += c.input
        t.output += c.output
        t.cacheRead += c.cacheRead
        t.cacheCreation += c.cacheCreation
        t.total += c.total
        return t
      },
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0 }
    )

    return {
      version: 1,
      scope: { kind: scopeKind, label: scopeLabel },
      grandTotal: grand,
      coverage: {
        toolTurns: coverage.toolTurns,
        perStepTurns: coverage.perStepTurns,
        perStepPct:
          coverage.toolTurns > 0
            ? coverage.perStepTurns / coverage.toolTurns
            : null,
      },
      byTool: withCommandBreakdown(
        rows,
        foldRows(
          rows,
          r => r.tool,
          () => undefined
        )
      ),
      byModel: foldRows(
        rows,
        r => r.model,
        () => undefined
      ),
      byMember: foldRows(
        rows,
        r => r.workspaceMemberId ?? '(unknown)',
        k => memberLabels.get(k)
      ),
      bySession: foldRows(rows, sessionKey, k => sessionLabel.get(k)),
    }
  },
}
