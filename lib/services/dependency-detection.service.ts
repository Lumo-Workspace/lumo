import { parseMentionedTaskIds } from '@/lib/editor/parse-mentions'
import {
  taskDependencyRepository,
  type SuggestedEdgeRow,
} from '@/lib/repositories/task-dependency.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { WRITE_TOOLS } from '@/lib/constants/hook-tools'

/** 共享文件数达到该值才算耦合候选。 */
export const SHARED_FILE_MIN = 3

/** 回看窗口:14 天内的写事件。 */
export const SHARED_FILE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

/**
 * 任一方向已有边(含 DISMISSED)的 pair 不再建议 —— dismiss 即免疫。
 * 空 rows 早返回,不调 repo(repo 内也有防护,此处为明确语义)。
 */
async function filterNewPairs(
  rows: SuggestedEdgeRow[]
): Promise<SuggestedEdgeRow[]> {
  if (rows.length === 0) return []
  const existing = await taskDependencyRepository.findPairsAmong(
    rows.map(r => ({ a: r.blockedTaskId, b: r.blockingTaskId }))
  )
  const seen = new Set(
    existing.flatMap((e: { blockedTaskId: string; blockingTaskId: string }) => [
      `${e.blockedTaskId}:${e.blockingTaskId}`,
      `${e.blockingTaskId}:${e.blockedTaskId}`,
    ])
  )
  return rows.filter(r => !seen.has(`${r.blockedTaskId}:${r.blockingTaskId}`))
}

export const dependencyDetectionService = {
  /**
   * 信号①:task→task @mention 持久化成 SUGGESTED 候选边。
   * 方向启发:提及方依赖被提及方(确认时可 --reverse)。调用方负责 waitUntil + catch。
   */
  async detectMentionEdges(opts: {
    taskId: string
    workspaceId: string
    html: string
    surface: 'description' | 'comment'
  }): Promise<void> {
    const mentioned = parseMentionedTaskIds(opts.html, opts.taskId)
    if (mentioned.length === 0) return

    const valid = await taskDependencyRepository.findTaskIdsInWorkspace(
      mentioned,
      opts.workspaceId
    )
    if (valid.length === 0) return

    const candidates: SuggestedEdgeRow[] = valid.map(id => ({
      workspaceId: opts.workspaceId,
      blockedTaskId: opts.taskId,
      blockingTaskId: id,
      reason: 'task_mention',
      detail: { surface: opts.surface },
    }))

    const rows = await filterNewPairs(candidates)
    await taskDependencyRepository.createManySuggested(rows)
  },

  /**
   * 信号②:共享文件耦合 sweep(hourly cron 纯 DB 段)。
   * HookEvent.filePath 按 taskId 聚合 → 未 DONE 任务两两交集 ≥ SHARED_FILE_MIN
   * → SUGGESTED。父子任务共享文件是常态,跳过。方向启发:older blocks newer。
   * 跨 workspace 的任务永远不配对。
   */
  async sweepSharedFileCandidates(now: Date): Promise<{ suggested: number }> {
    const since = new Date(now.getTime() - SHARED_FILE_WINDOW_MS)
    const touched = await hookEventRepository.groupTaskFilesTouched({
      since,
      toolNames: WRITE_TOOLS,
    })

    // Build per-task file sets and workspace mapping (narrow nullable columns inline).
    const filesByTask = new Map<string, Set<string>>()
    const workspaceByTask = new Map<string, string>()
    for (const r of touched) {
      if (!r.taskId || !r.filePath) continue
      workspaceByTask.set(r.taskId, r.workspaceId)
      const set = filesByTask.get(r.taskId) ?? new Set<string>()
      set.add(r.filePath)
      filesByTask.set(r.taskId, set)
    }

    // Only consider open (non-DONE) tasks.
    const metas = await taskDependencyRepository.findOpenTasksMeta([
      ...filesByTask.keys(),
    ])

    const candidates: SuggestedEdgeRow[] = []
    for (let i = 0; i < metas.length; i++) {
      for (let j = i + 1; j < metas.length; j++) {
        const a = metas[i]
        const b = metas[j]
        if (!a || !b) continue

        // Same workspace guard.
        const workspaceId = workspaceByTask.get(a.id)
        if (!workspaceId || workspaceId !== workspaceByTask.get(b.id)) continue

        // Intersection check.
        const fa = filesByTask.get(a.id) ?? new Set<string>()
        const fb = filesByTask.get(b.id) ?? new Set<string>()
        const shared = [...fa].filter(f => fb.has(f)).sort()
        if (shared.length < SHARED_FILE_MIN) continue

        // Direction heuristic: older task blocks newer.
        const [older, newer] = a.createdAt <= b.createdAt ? [a, b] : [b, a]
        candidates.push({
          workspaceId,
          blockedTaskId: newer.id,
          blockingTaskId: older.id,
          reason: 'shared_files',
          detail: { count: shared.length, sample: shared.slice(0, 5) },
        })
      }
    }

    const rows = await filterNewPairs(candidates)
    const res = await taskDependencyRepository.createManySuggested(rows)
    return { suggested: res.count }
  },
}
