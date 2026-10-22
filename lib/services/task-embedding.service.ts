import { embedTexts } from '@/lib/ai/embedding'
import { logger } from '@/lib/logger'
import { taskRepository } from '@/lib/repositories/task.repository'

/**
 * LUM-1286 step 2: keep Task.titleEmbedding current so duplicate checks can
 * recall candidates by meaning, not spelling. Runs after the response
 * (callers wrap it in waitUntil); never throws — a task without an embedding
 * is only invisible to embedding recall, which falls back to bigram.
 */
export async function stampTaskTitleEmbedding(
  taskId: string,
  title: string
): Promise<void> {
  if (!title.trim()) return
  try {
    const [vector] = await embedTexts([title])
    if (vector) await taskRepository.setTitleEmbedding(taskId, vector)
  } catch (err) {
    logger.warn(
      '[task-embedding] title embedding skipped:',
      err instanceof Error ? err.message : err
    )
  }
}

/**
 * Embed live tasks that have no title embedding yet, newest first, until none
 * are left or `limit` is reached. Stops at the first batch that cannot be
 * embedded rather than retrying the same rows forever.
 */
export async function backfillTaskTitleEmbeddings(opts: {
  batchSize: number
  limit: number
  /** Stop between batches once this passes (a serverless time budget). */
  deadline?: Date
}): Promise<{ embedded: number; failed: number; stoppedAtDeadline: boolean }> {
  let embedded = 0
  while (embedded < opts.limit) {
    if (opts.deadline && Date.now() >= opts.deadline.getTime()) {
      return { embedded, failed: 0, stoppedAtDeadline: true }
    }
    const rows = await taskRepository.findMissingTitleEmbeddings(
      Math.min(opts.batchSize, opts.limit - embedded)
    )
    if (rows.length === 0) break
    let vectors: number[][]
    try {
      vectors = await embedTexts(rows.map(r => r.title || ' '))
    } catch (err) {
      logger.warn(
        '[task-embedding] backfill batch failed:',
        err instanceof Error ? err.message : err
      )
      return { embedded, failed: rows.length, stoppedAtDeadline: false }
    }
    let stored = 0
    for (const [i, row] of rows.entries()) {
      const vector = vectors[i]
      if (!vector) continue
      await taskRepository.setTitleEmbedding(row.id, vector)
      stored++
    }
    embedded += stored
    // A short batch leaves rows NULL that the next fetch would return again.
    if (stored < rows.length) {
      return {
        embedded,
        failed: rows.length - stored,
        stoppedAtDeadline: false,
      }
    }
  }
  return { embedded, failed: 0, stoppedAtDeadline: false }
}

export interface TaskTitleEmbeddingBackfillReport {
  dryRun: boolean
  /** Live tasks without a title embedding when the run started. */
  missingBefore: number
  embedded: number
  failed: number
  missingAfter: number
  /** True when the time budget ran out with rows left — the next run resumes. */
  stoppedAtDeadline: boolean
}

/**
 * LUM-1286: one run of the scheduled backfill (`/api/cron/backfill-task-title-
 * embeddings`). Counts first; a dry run stops there. Otherwise embeds until
 * nothing is missing or the deadline passes, then counts again. Idempotent —
 * only NULL rows are written, so the next scheduled run picks up the rest.
 */
export async function runTaskTitleEmbeddingBackfill(opts: {
  dryRun: boolean
  deadline: Date
  batchSize?: number
}): Promise<TaskTitleEmbeddingBackfillReport> {
  const missingBefore = await taskRepository.countMissingTitleEmbeddings()
  if (opts.dryRun || missingBefore === 0) {
    return {
      dryRun: opts.dryRun,
      missingBefore,
      embedded: 0,
      failed: 0,
      missingAfter: missingBefore,
      stoppedAtDeadline: false,
    }
  }
  const result = await backfillTaskTitleEmbeddings({
    batchSize: opts.batchSize ?? 96,
    limit: missingBefore,
    deadline: opts.deadline,
  })
  const missingAfter = await taskRepository.countMissingTitleEmbeddings()
  const report = { dryRun: false, missingBefore, ...result, missingAfter }
  logger.info('[task-embedding] backfill run:', JSON.stringify(report))
  return report
}
