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
}): Promise<{ embedded: number; failed: number }> {
  let embedded = 0
  while (embedded < opts.limit) {
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
      return { embedded, failed: rows.length }
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
    if (stored < rows.length) return { embedded, failed: rows.length - stored }
  }
  return { embedded, failed: 0 }
}
