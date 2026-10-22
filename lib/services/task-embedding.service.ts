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
 * Embed one page of titles. When the batch call fails or comes back short,
 * retry each title alone so one bad title cannot sink its neighbours; a title
 * that still fails maps to null.
 */
async function embedTitlesOrNull(titles: string[]): Promise<(number[] | null)[]> {
  try {
    const vectors = await embedTexts(titles)
    if (vectors.length === titles.length) return vectors
  } catch (err) {
    logger.warn(
      '[task-embedding] backfill batch failed, retrying one by one:',
      err instanceof Error ? err.message : err
    )
  }
  const out: (number[] | null)[] = []
  for (const title of titles) {
    try {
      const [vector] = await embedTexts([title])
      out.push(vector ?? null)
    } catch {
      out.push(null)
    }
  }
  return out
}

/**
 * Embed live tasks that have no title embedding yet, newest first, until none
 * are left, `limit` rows have been tried or the deadline passes. Pages by key,
 * so a row that cannot be embedded is skipped (counted in `failed`, logged at
 * error level) instead of blocking every older row behind it. Stops early when
 * a whole page fails — the gateway is down, not one title.
 */
export async function backfillTaskTitleEmbeddings(opts: {
  batchSize: number
  limit: number
  /** Stop between batches once this passes (a serverless time budget). */
  deadline?: Date
}): Promise<{ embedded: number; failed: number; stoppedAtDeadline: boolean }> {
  let embedded = 0
  let failed = 0
  let after: { createdAt: Date; id: string } | undefined
  while (embedded + failed < opts.limit) {
    if (opts.deadline && Date.now() >= opts.deadline.getTime()) {
      return { embedded, failed, stoppedAtDeadline: true }
    }
    const rows = await taskRepository.findMissingTitleEmbeddings(
      Math.min(opts.batchSize, opts.limit - embedded - failed),
      after
    )
    const last = rows[rows.length - 1]
    if (!last) break
    after = { createdAt: last.createdAt, id: last.id }
    const vectors = await embedTitlesOrNull(rows.map(r => r.title || ' '))
    const skipped: string[] = []
    for (const [i, row] of rows.entries()) {
      const vector = vectors[i]
      if (!vector) {
        skipped.push(row.id)
        continue
      }
      await taskRepository.setTitleEmbedding(row.id, vector)
      embedded++
    }
    failed += skipped.length
    if (skipped.length > 0) {
      logger.error('[task-embedding] backfill skipped tasks:', skipped)
    }
    if (skipped.length === rows.length) break
  }
  return { embedded, failed, stoppedAtDeadline: false }
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
  if (report.failed > 0) {
    logger.error('[task-embedding] backfill run left tasks unembedded:', report)
  } else {
    logger.info('[task-embedding] backfill run:', report)
  }
  return report
}
