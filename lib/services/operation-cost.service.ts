import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import {
  attributeOperationCost,
  type OperationCostRow,
} from '@/lib/agent-run/operation-cost'
import type { ModelUsage } from '@/lib/services/model-cost'
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
    const label = labelOf(r.key)
    if (label) r.label = label
  }
  return out.sort((a, b) => b.total - a.total)
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
      scopeLabel = `last ${DEFAULT_WINDOW_DAYS}d`
    }

    const { rows, coverage } = attributeOperationCost(
      events.map(e => ({
        sessionId: e.sessionId,
        workspaceMemberId: e.workspaceMemberId,
        type: e.type,
        toolName: e.toolName,
        toolDetail: e.toolDetail,
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

    const grand = rows.reduce(
      (t, r) => {
        t.input += r.input
        t.output += r.output
        t.cacheRead += r.cacheRead
        t.cacheCreation += r.cacheCreation
        return t
      },
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
    )

    return {
      version: 1,
      scope: { kind: scopeKind, label: scopeLabel },
      grandTotal: {
        ...grand,
        total:
          grand.input + grand.output + grand.cacheRead + grand.cacheCreation,
      },
      coverage: {
        toolTurns: coverage.toolTurns,
        perStepTurns: coverage.perStepTurns,
        perStepPct:
          coverage.toolTurns > 0
            ? coverage.perStepTurns / coverage.toolTurns
            : null,
      },
      byTool: foldRows(
        rows,
        r => r.tool,
        () => undefined
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
      bySession: foldRows(
        rows,
        r => r.sessionId ?? '(none)',
        k => (k.length > 8 ? k.slice(0, 8) : k)
      ),
    }
  },
}
