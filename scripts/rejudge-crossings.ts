/**
 * LUM-780 — re-judge OPEN blocking POLICY_WEAKENING / TEST_FILE_DELETED
 * boundary crossings against the CURRENT state, and report per row why each
 * one keeps blocking, becomes advisory, or cannot be decided.
 *
 * The same pass the hourly cron runs (`boundaryCrossingRejudgeService.sweep`)
 * — this script exists so a human can read the plan BEFORE the deploy that
 * turns the cron on, and so the PR that ships it carries real numbers. Nothing
 * here dispositions anything; a CAUSE_GONE write makes the row advisory (still
 * open, trailed) and leaves the human ruling exactly where it was.
 *
 * Dry-run by default; pass --apply to write. Production: read-only runs are
 * fine; `--apply` against prod only with explicit per-session authorization,
 * from the MAIN checkout (`.env.production` is gitignored and absent in
 * worktrees):
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/rejudge-crossings.ts [--limit N] [--task <taskId>]          # dry-run
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/rejudge-crossings.ts --apply                                  # write
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { prisma } from '@/lib/db/prisma'
import {
  boundaryCrossingRejudgeService,
  type RejudgeDecision,
} from '@/lib/services/boundary-crossing-rejudge.service'

interface Args {
  apply: boolean
  limit: number
  taskId: string | null
  /** Dry-run only: judge POLICY_WEAKENING rows against this local file
   *  instead of reading CLAUDE.md/AGENTS.md through the GitHub App — the
   *  machine running the script rarely holds the App's private key. */
  sourceFile: string | null
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { apply: false, limit: 200, taskId: null, sourceFile: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') {
      out.apply = true
    } else if (a === '--limit') {
      const v = Number(argv[++i])
      if (!Number.isInteger(v) || v <= 0)
        throw new Error('--limit expects a positive integer')
      out.limit = v
    } else if (a === '--task') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error('--task expects a task id')
      out.taskId = v
    } else if (a === '--source-file') {
      const v = argv[++i]
      if (!v || v.startsWith('--'))
        throw new Error('--source-file expects a path')
      out.sourceFile = v
    } else {
      throw new Error(`unknown argument "${a ?? ''}"`)
    }
  }
  return out
}

function short(s: string, n = 150): string {
  const t = s.replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function printDecision(d: RejudgeDecision): void {
  const mark = d.written ? '↓' : d.outcome === 'CAUSE_GONE' ? '·' : ' '
  console.log(
    `  ${mark} ${d.outcome.padEnd(11)} ${d.reason.padEnd(24)} ${d.id} task=${d.taskId ?? '-'} ${d.category}\n      ${short(d.evidence)}`
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.sourceFile && args.apply) {
    throw new Error(
      '--source-file is a dry-run aid; an --apply pass must read the source the cron reads (the GitHub App)'
    )
  }
  const localSource = args.sourceFile
    ? readFileSync(args.sourceFile, 'utf8')
    : null
  const summary = await boundaryCrossingRejudgeService.sweep({
    limit: args.limit,
    dryRun: !args.apply,
    ...(localSource != null ? { readSource: async () => localSource } : {}),
  })
  const decisions = args.taskId
    ? summary.decisions.filter(d => d.taskId === args.taskId)
    : summary.decisions

  const bucket = (o: RejudgeDecision['outcome']) =>
    decisions.filter(d => d.outcome === o)
  console.log(
    `${args.apply ? 'APPLIED' : 'DRY-RUN'} — ${summary.judged} row(s) judged, ${summary.errors} error(s)`
  )
  console.log(`\nCAUSE_GONE → advisory (${bucket('CAUSE_GONE').length}):`)
  bucket('CAUSE_GONE').forEach(printDecision)
  console.log(
    `\nSTILL_HOLDS → keeps blocking (${bucket('STILL_HOLDS').length}):`
  )
  bucket('STILL_HOLDS').forEach(printDecision)
  console.log(`\nUNDECIDABLE → untouched (${bucket('UNDECIDABLE').length}):`)
  bucket('UNDECIDABLE').forEach(printDecision)
  console.log('\nby reason:')
  for (const [reason, n] of Object.entries(summary.byReason).sort()) {
    console.log(`  ${reason.padEnd(24)} ${n}`)
  }
  if (!args.apply) {
    console.log(
      '\n[dry-run] nothing written. Re-run with --apply to make the CAUSE_GONE rows advisory (the hourly cron does the same after deploy).'
    )
  } else {
    console.log(`\nmade ${summary.downgraded} row(s) advisory`)
  }
  await prisma.$disconnect()
}

if (require.main === module) {
  main().catch(async error => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
}
