/**
 * LUM-914 — the pre-rule retention stock: data stored before the automatic
 * cleanup rules shipped, which the daily sweeps deliberately never touch.
 * Three categories (rules: lib/services/retention-stock.service.ts):
 *
 *   scan-evidence  PR security scans from before LUM-911 still holding code
 *   crossing-raw   boundary crossings dispositioned before LUM-912 still
 *                  holding their raw text
 *   dead-letter    PR comment sync jobs dead-lettered before LUM-913 still
 *                  holding the GitHub webhook payload
 *
 * Session records (hook events) are NOT stock: they are kept forever by
 * default, and a stricter setting only governs events stored afterwards.
 *
 * ── Before any --apply: take a rollback point ──────────────────────────────
 * Create a Neon branch of the production database yourself (Console → Branches
 * → Create branch from the current head), named e.g.
 *     pre-lum914-<category>-<YYYYMMDD>
 * and keep it at least 14 days (until the result is verified and nobody
 * needs the text back). This script never creates or deletes branches.
 * Rolling back = restoring the affected rows from that branch: the apply
 * rewrites columns in place, it deletes no row.
 *
 * Usage (DATABASE_URL comes from the environment you run it in; nothing is
 * loaded implicitly):
 *
 *   # read-only dry run, every category
 *   DOTENV_CONFIG_PATH=<env file> npx tsx -r dotenv/config \
 *     scripts/retention-stock/run.ts all
 *
 *   # trial apply on 5 rows, then a bigger run, then a rerun that writes 0
 *   DOTENV_CONFIG_PATH=<env file> npx tsx -r dotenv/config \
 *     scripts/retention-stock/run.ts dead-letter --apply \
 *     --confirm-scope dead-letter --confirm-host <db host> \
 *     --rollback-branch pre-lum914-dead-letter-<YYYYMMDD> --limit 5
 *
 * The dry run prints counts, workspace slugs and dates only — never a
 * payload. --apply takes one category, requires --confirm-scope to repeat it
 * and --confirm-host to equal the connected host, and --rollback-branch to
 * name the Neon branch you took (recorded in the output, not checked). It
 * prints the plan before and after, and processes in batches of --batch-size
 * (default 20, max 200). Each scan-evidence batch is one transaction (15s
 * timeout); each crossing is its own transaction (15s timeout); each dead
 * letter is one guarded UPDATE.
 */
import { prisma } from '@/lib/db/prisma'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { retentionStockService } from '@/lib/services/retention-stock.service'
import { assertApplyHost } from '@/lib/services/secret-stock-reredact.service'
import {
  USAGE,
  formatApplyResult,
  formatStockPlan,
  parseStockArgs,
} from './args'

function out(line: string) {
  process.stdout.write(`${line}\n`)
}

function err(line: string) {
  process.stderr.write(`${line}\n`)
}

async function main() {
  let args: ReturnType<typeof parseStockArgs>
  try {
    args = parseStockArgs(process.argv.slice(2))
  } catch (e) {
    err((e as Error).message)
    err(USAGE)
    process.exit(2)
  }
  if (!process.env.DATABASE_URL) {
    err('DATABASE_URL is not set (pass the env file with DOTENV_CONFIG_PATH).')
    process.exit(2)
  }
  const host = new URL(process.env.DATABASE_URL).host
  if (args.apply) {
    try {
      assertApplyHost(process.env.DATABASE_URL, args.confirmHost)
    } catch (e) {
      err((e as Error).message)
      process.exit(2)
    }
  }

  const options = {
    batchSize: args.batchSize,
    ...(args.limit !== undefined ? { limit: args.limit } : {}),
    ...(args.crossingRolloutAt
      ? { crossingRolloutAt: args.crossingRolloutAt }
      : {}),
  }
  const printPlan = async (
    label: string,
    category: (typeof args.categories)[number]
  ) => {
    const plan = await retentionStockService.plan(category, options)
    const slugs = await workspaceRepository.findSlugs(
      Object.keys(plan.byWorkspace)
    )
    out(`[${label}]`)
    for (const line of formatStockPlan(plan, slugs)) out(line)
    return plan
  }

  out(
    `[${args.apply ? 'apply' : 'dry-run'}] LUM-914 pre-rule retention stock · db ${host}` +
      (args.limit !== undefined ? ` · limit ${args.limit}` : '') +
      ` · batch ${args.batchSize}`
  )
  if (!args.apply) {
    for (const category of args.categories) await printPlan('plan', category)
    if (args.limit !== undefined)
      out('(--limit only bounds an --apply; the dry run counts everything)')
    await prisma.$disconnect()
    return
  }

  const category = args.categories[0]!
  out(
    `Rollback point (operator-declared Neon branch): ${args.rollbackBranch}. ` +
      'Keep it ≥14 days.'
  )
  const before = await printPlan('before', category)
  if (before.due === 0) {
    out('Nothing due — no writes.')
    await prisma.$disconnect()
    return
  }
  const result = await retentionStockService.apply(category, {
    ...options,
    onBatch: p => err(`  … processed=${p.processed} lastId=${p.lastId}`),
  })
  out(`[applied] ${formatApplyResult(result)}`)
  await printPlan('after', category)
  out(
    'Rollback: restore the rewritten columns of the processed rows from the ' +
      'Neon branch taken before this run (rows were rewritten in place, none deleted).'
  )
  await prisma.$disconnect()
}

main().catch(error => {
  err(
    `[retention-stock] failed: ${error instanceof Error ? error.stack : String(error)}`
  )
  process.exit(1)
})
