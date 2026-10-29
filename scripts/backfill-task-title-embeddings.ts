/**
 * LUM-1286 step 2: one-shot backfill of Task.titleEmbedding for live tasks
 * created before the column existed. Safe to re-run — only rows still NULL are
 * touched, newest first. Stops at the first batch the gateway rejects.
 *
 * Usage:
 *   npx tsx --env-file=<env file> scripts/backfill-task-title-embeddings.ts --dry-run
 *   npx tsx --env-file=<env file> scripts/backfill-task-title-embeddings.ts [--limit 5000] [--batch-size 96]
 *
 * Needs the database URL and AI_GATEWAY_API_KEY in the env file. Production
 * runs need the user's explicit go-ahead.
 */
import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'
import { backfillTaskTitleEmbeddings } from '@/lib/services/task-embedding.service'

const args = process.argv.slice(2)
const flag = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? Number(args[i + 1]) : dflt
}

async function main() {
  const limit = flag('limit', 1_000_000)
  const batchSize = flag('batch-size', 96)
  if (args.includes('--dry-run')) {
    const rows = await taskRepository.findMissingTitleEmbeddings(limit)
    process.stdout.write(
      `dry run: ${rows.length} live task(s) without a title embedding\n`
    )
    return
  }
  const started = Date.now()
  const out = await backfillTaskTitleEmbeddings({ batchSize, limit })
  process.stdout.write(
    `embedded ${out.embedded}, failed ${out.failed} in ${Math.round((Date.now() - started) / 1000)}s\n`
  )
  if (out.failed > 0) process.exitCode = 1
}

main()
  .catch(e => {
    process.stderr.write(String(e) + '\n')
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
