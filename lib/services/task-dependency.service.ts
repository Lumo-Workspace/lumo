import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import { logger } from '@/lib/logger'
import { isPrismaUniqueViolation } from '@/lib/db/errors'

/**
 * LUM-172 任务依赖 CRUD + 防环 + 告警渲染。
 * 红线:检测边只能由人确认(confirm),服务层绝不自动把 SUGGESTED 升级成 CONFIRMED。
 */

export interface DependencyEdgeView {
  id: string
  direction: 'BLOCKED_BY' | 'BLOCKS'
  kind: string
  source: string
  status: string
  reason: string | null
  detail: unknown
  other: { identifier: string; title: string; status: string }
}

type EdgeWithTasks = Awaited<ReturnType<typeof taskDependencyRepository.findEdgesForTask>>[number]

function toView(edge: EdgeWithTasks, taskId: string): DependencyEdgeView {
  const blockedSide = edge.blockedTaskId === taskId
  const other = blockedSide ? edge.blockingTask : edge.blockedTask
  return {
    id: edge.id,
    direction: blockedSide ? 'BLOCKED_BY' : 'BLOCKS',
    kind: edge.kind,
    source: edge.source,
    status: edge.status,
    reason: edge.reason,
    detail: edge.detail,
    other: {
      identifier: `${other.team.identifier}-${other.number}`,
      title: other.title,
      status: other.status,
    },
  }
}

/**
 * 已确认 BLOCKS 图上,加边 (blocked ← blocking) 是否成环:
 * 从 blocking 沿「依赖于」方向 DFS 能否回到 blocked。
 *
 * 并发 check-then-write 在极端竞态下可绕过防环(与本仓 tag/sprint 服务同口径的取舍,小团队人工操作概率可忽略;同 pair 撞 unique 由 DB 兜底)。
 */
async function assertNoCycle(
  workspaceId: string,
  blockedTaskId: string,
  blockingTaskId: string,
): Promise<void> {
  const edges = await taskDependencyRepository.findConfirmedBlocksEdges(workspaceId)
  // Build adjacency: blockedTaskId → [blockingTaskIds] (i.e., "depends on")
  const dependsOn = new Map<string, string[]>()
  for (const e of edges) {
    const list = dependsOn.get(e.blockedTaskId) ?? []
    list.push(e.blockingTaskId)
    dependsOn.set(e.blockedTaskId, list)
  }
  // DFS from blockingTaskId — if we can reach blockedTaskId, adding the edge creates a cycle
  const stack = [blockingTaskId]
  const seen = new Set<string>()
  while (stack.length > 0) {
    const cur = stack.pop() as string
    if (cur === blockedTaskId) {
      throw Object.assign(new Error('Dependency would create a cycle'), { status: 409 })
    }
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const next of dependsOn.get(cur) ?? []) stack.push(next)
  }
}

export const taskDependencyService = {
  async listForTask(taskId: string): Promise<DependencyEdgeView[]> {
    const edges = await taskDependencyRepository.findEdgesForTask(taskId)
    return edges.map(e => toView(e, taskId))
  },

  /** 手工硬依赖入口:直接 MANUAL + CONFIRMED(人确知的边,极薄入口)。 */
  async addManual(input: {
    workspaceId: string
    blockedTaskId: string
    blockingTaskId: string
    kind?: 'BLOCKS' | 'RELATES' | undefined
  }) {
    const { workspaceId, blockedTaskId, blockingTaskId } = input
    const kind = input.kind ?? 'BLOCKS'

    if (blockedTaskId === blockingTaskId) {
      throw Object.assign(new Error('A task cannot depend on itself'), { status: 400 })
    }

    const existing = await taskDependencyRepository.findByPair(blockedTaskId, blockingTaskId)

    if (existing?.status === 'CONFIRMED') {
      throw Object.assign(new Error('Dependency already exists'), { status: 409 })
    }

    if (kind === 'BLOCKS') {
      await assertNoCycle(workspaceId, blockedTaskId, blockingTaskId)
    }

    if (existing) {
      // 检测器先一步发现的同向候选:人工 add 等于确认它,保留 DETECTED 出处。
      return taskDependencyRepository.update(existing.id, {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
      })
    }

    return taskDependencyRepository.create({
      workspaceId,
      blockedTaskId,
      blockingTaskId,
      kind,
      source: 'MANUAL',
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    })
  },

  /** 一键确认候选边;reverse 翻转方向(检测器的方向只是启发)。 */
  async confirm(input: { edgeId: string; reverse?: boolean | undefined }) {
    const edge = await taskDependencyRepository.findById(input.edgeId)
    if (!edge) throw Object.assign(new Error('Dependency not found'), { status: 404 })

    const [blockedTaskId, blockingTaskId] = input.reverse
      ? [edge.blockingTaskId, edge.blockedTaskId]
      : [edge.blockedTaskId, edge.blockingTaskId]

    if (input.reverse) {
      const reverseExisting = await taskDependencyRepository.findByPair(blockedTaskId, blockingTaskId)
      if (reverseExisting) {
        throw Object.assign(new Error('Reverse edge already exists'), { status: 409 })
      }
    }

    if (edge.kind === 'BLOCKS') {
      await assertNoCycle(edge.workspaceId, blockedTaskId, blockingTaskId)
    }

    try {
      return await taskDependencyRepository.update(edge.id, {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        ...(input.reverse ? { blockedTaskId, blockingTaskId } : {}),
      })
    } catch (err) {
      if (input.reverse && isPrismaUniqueViolation(err)) {
        throw Object.assign(new Error('Reverse edge already exists'), { status: 409 })
      }
      throw err
    }
  },

  /** 否决候选:留行不删,挡住检测器下轮重新建议。 */
  async dismiss(edgeId: string) {
    const edge = await taskDependencyRepository.findById(edgeId)
    if (!edge) throw Object.assign(new Error('Dependency not found'), { status: 404 })
    return taskDependencyRepository.update(edgeId, { status: 'DISMISSED', confirmedAt: null })
  },

  async remove(edgeId: string) {
    const edge = await taskDependencyRepository.findById(edgeId)
    if (!edge) throw Object.assign(new Error('Dependency not found'), { status: 404 })
    await taskDependencyRepository.delete(edgeId)
  },

  /**
   * agent 调度告警(v1 唯一变现落点):attach/session-start 时注入。
   * 永不抛 —— 告警挂了不能弄死 session 启动。
   */
  async buildBlockerWarningSectionForTask(
    taskId: string,
    taskIdentifier: string,
  ): Promise<string> {
    try {
      const [blockers, suggestedCount] = await Promise.all([
        taskDependencyRepository.findLiveBlockersForTask(taskId),
        taskDependencyRepository.countSuggestedForTask(taskId),
      ])

      if (blockers.length === 0 && suggestedCount === 0) return ''

      const parts: string[] = []

      if (blockers.length > 0) {
        parts.push('## ⚠ 依赖告警', '')
        for (const b of blockers) {
          const t = b.blockingTask
          const ident = `${t.team.identifier}-${t.number}`
          const pr = t.pullRequests[0]
          const prNote = pr ? `,PR #${pr.number}${pr.isDraft ? ' (draft)' : ''} 未 merge` : ''
          parts.push(`- 本任务被 ${ident}「${t.title}」阻塞(状态 ${t.status}${prNote})。`)
        }
        parts.push(
          '',
          '建议先等 blocker 合并再开工,避免白跑 run;如边已过时,用 `lumo task deps rm/dismiss` 清理。',
        )
      }

      if (suggestedCount > 0) {
        parts.push(
          `检测到 ${suggestedCount} 条候选依赖待确认:运行 \`lumo task deps list ${taskIdentifier}\`。`,
        )
      }

      return parts.join('\n')
    } catch (err) {
      logger.error('buildBlockerWarningSectionForTask failed; omitting blocker warning', err)
      return ''
    }
  },
}
