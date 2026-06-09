/**
 * One-shot backfill: compute and store pgvector embeddings for all `memories`
 * rows where the `embedding` column is NULL. Safe to run multiple times —
 * already-embedded rows are not touched. Run with --dry-run to see counts
 * without writing.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-memory-embeddings.ts
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-memory-embeddings.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register scripts/backfill-memory-embeddings.ts --batch-size 50
 *
 * Requires DATABASE_URL_UNPOOLED and AI_GATEWAY_API_KEY to be set in the
 * environment (or .env.production for production runs).
 */
import type { MemoryCategory } from '@prisma/client'

export interface BackfillDeps {
  /**
   * Fetch the next batch of rows where embedding IS NULL, keyset-paginated by
   * id: return rows with `id > afterId` (or from the start when afterId is
   * undefined), ordered by id ASC. Keyset (not OFFSET) keeps the loop
   * terminating in BOTH modes — including dry-run (nothing is stored, so an
   * IS-NULL-only query would re-return the same rows forever) and rows with
   * empty content that are skipped without being stored.
   */
  fetchUnembeddedBatch: (
    limit: number,
    afterId?: string
  ) => Promise<Array<{ id: string; category: MemoryCategory; content: unknown }>>
  /** Embed N texts, returning one 1024-d vector per text (order-preserving). */
  embed: (texts: string[]) => Promise<number[][]>
  /** Persist the embedding vector for a single row. */
  store: (id: string, vector: number[]) => Promise<void>
  batchSize?: number
  dryRun?: boolean
  log?: (msg: string) => void
}

export interface BackfillResult {
  processed: number
  embedded: number
  failedBatches: number
}

/**
 * Core DI-testable logic. Loops over unembedded rows in batches:
 *  1. Fetch a batch of rows with `embedding IS NULL`.
 *  2. Convert each row's content to a flat text string via
 *     `memoryContentToText`.
 *  3. Embed the entire batch in a single `embed` call.
 *  4. Store each vector (unless dryRun).
 *  5. Repeat until an empty batch signals exhaustion.
 *
 * Per-batch try/catch: an `embed` failure increments `failedBatches` and
 * continues — the rows stay NULL and will be retried on the next run
 * (idempotent/resumable).
 */
export async function backfillMemoryEmbeddings(
  deps: BackfillDeps
): Promise<BackfillResult> {
  // Lazy import so the script module doesn't pull ai/embedding into the test
  // bundle (no AI_GATEWAY_API_KEY in CI).
  const { memoryContentToText } = await import('@/lib/memory/content-text')

  const {
    fetchUnembeddedBatch,
    embed,
    store,
    batchSize = 100,
    dryRun = false,
    log = () => undefined,
  } = deps

  const result: BackfillResult = { processed: 0, embedded: 0, failedBatches: 0 }

  // Keyset cursor by id — advances every iteration regardless of whether rows
  // were stored, so the loop always terminates (dry-run stores nothing; empty-
  // text rows are skipped without storing).
  let afterId: string | undefined = undefined

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch = await fetchUnembeddedBatch(batchSize, afterId)
    if (batch.length === 0) break

    result.processed += batch.length
    afterId = batch[batch.length - 1]!.id
    log(`Fetched batch of ${batch.length} rows (total processed so far: ${result.processed})`)

    // Compute text for each row; rows with empty text are skipped (nothing to embed).
    const textByIndex: Map<number, string> = new Map()
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i]
      if (row === undefined) continue
      const text = memoryContentToText(row.category, row.content)
      if (text.length > 0) {
        textByIndex.set(i, text)
      }
    }

    if (textByIndex.size === 0) {
      log('Batch had no embeddable text — skipping embed call.')
      continue
    }

    // Dry-run is a count preview: never calls the model or writes. Counting the
    // embeddable rows is enough; advancing afterId guarantees termination.
    if (dryRun) {
      result.embedded += textByIndex.size
      log(`[dry-run] Would embed ${result.embedded} rows so far.`)
      continue
    }

    // Build parallel arrays so we can map vectors back to rows.
    const indices = [...textByIndex.keys()]
    const texts = indices.map(i => textByIndex.get(i) as string)

    let vectors: number[][]
    try {
      vectors = await embed(texts)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log(`embed() failed for batch — skipping (${msg})`)
      result.failedBatches++
      continue
    }

    for (let j = 0; j < indices.length; j++) {
      const rowIndex = indices[j]
      const vector = vectors[j]
      if (rowIndex === undefined || vector === undefined) continue
      const row = batch[rowIndex]
      if (row === undefined) continue

      await store(row.id, vector)
      result.embedded++
    }

    log(`Embedded ${result.embedded} rows so far.`)
  }

  return result
}

// ---------------------------------------------------------------------------
// Thin runnable entry-point (wires real deps)
// ---------------------------------------------------------------------------

if (require.main === module) {
  ;(async () => {
    // Load env (DATABASE_URL, AI_GATEWAY_API_KEY) BEFORE importing the prisma
    // client — its PrismaPg adapter reads DATABASE_URL at module-eval time, so
    // dotenv must run first or the connection string is empty. Honors
    // DOTENV_CONFIG_PATH for non-default env files (e.g. a worktree).
    await import('dotenv/config')
    // Lazy-import so tests never load prisma/ai-sdk.
    const { prisma } = await import('@/lib/db/prisma')
    const { Prisma } = await import('@prisma/client')
    const { embedTexts } = await import('@/lib/ai/embedding')
    const { memoryRepository } = await import(
      '@/lib/repositories/memory.repository'
    )

    const dryRun = process.argv.includes('--dry-run')
    const batchArg = process.argv.find(a => a.startsWith('--batch-size='))
    const batchSize = batchArg ? parseInt(batchArg.split('=')[1] ?? '100', 10) : 100

    // eslint-disable-next-line no-console
    console.log(
      `[backfill-memory-embeddings] mode=${dryRun ? 'DRY-RUN' : 'APPLY'} batchSize=${batchSize}`
    )

    const result = await backfillMemoryEmbeddings({
      fetchUnembeddedBatch: async (limit: number, afterId?: string) => {
        // pgvector column is Unsupported → must use raw SQL.
        // deliberate pgvector exception to the "no raw SQL" rule, same
        // as the comment block in memory.repository.ts.
        // Keyset pagination by id (not OFFSET) — see BackfillDeps docstring.
        type Row = { id: string; category: string; content: unknown }
        const cursor = afterId
          ? Prisma.sql`AND "id" > ${afterId}`
          : Prisma.empty
        const rows = await prisma.$queryRaw<Row[]>(
          Prisma.sql`
            SELECT id, category, content
            FROM "memories"
            WHERE "embedding" IS NULL ${cursor}
            ORDER BY "id" ASC
            LIMIT ${limit}
          `
        )
        return rows.map(r => ({
          id: r.id,
          // Cast: the DB category column is constrained to the enum; trust it.
          category: r.category as import('@prisma/client').MemoryCategory,
          content: r.content,
        }))
      },
      embed: embedTexts,
      store: (id, vector) => memoryRepository.setEmbedding(id, vector),
      batchSize,
      dryRun,
      // eslint-disable-next-line no-console
      log: msg => console.log(`  ${msg}`),
    })

    // eslint-disable-next-line no-console
    console.log(
      `\n[backfill-memory-embeddings] done — processed=${result.processed} embedded=${result.embedded} failedBatches=${result.failedBatches}`
    )
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log('Re-run without --dry-run to apply.')
    }
    await prisma.$disconnect()
  })().catch(err => {
    // eslint-disable-next-line no-console
    console.error(err)
    process.exit(1)
  })
}
