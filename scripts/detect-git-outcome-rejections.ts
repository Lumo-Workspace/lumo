/**
 * LUM-601 / LUM-607 — git-topology referent backfill for the post-hoc outcome well.
 *
 * Scans delivered tasks (DONE, with a merged PR) and records any git-topology
 * rejection — a formal revert or a downstream content reversal — into the well
 * as a source=GIT OutcomeSignal. Idempotent: re-running never double-inserts
 * (keyed by revertingSha), and it shares the recorder/dedup with the LUM-607
 * webhook forward feed, so the backfill and the steady-state feed never
 * double-count the same revert.
 *
 * DELIVERY SHA RESOLUTION (LUM-607): the detector's only input is a delivery's
 * commit sha. `PullRequest.mergeCommitSha` was added late ("LUM-598 groundwork")
 * so almost all historical merged PRs have it null — leaving the well blind to
 * history (incl. LUM-587, reverted by aee920c6). We therefore resolve each PR's
 * delivery commit from git when the column is empty: the squash commit on
 * origin/main whose SUBJECT ENDS with `(#<prNumber>)`. No PR rows are written.
 *
 * WHY A SCRIPT, NOT THE CRON: the detector reads git, so it can only run where a
 * checkout exists (CI / a maintainer's machine / a checkout-backed cron) — never
 * the serverless server cron, which has no repo. Run it from the repo root with
 * origin/main fetched. The trigger is intentionally scheduler-agnostic (cron,
 * CI, k8s CronJob, a maintainer) — wire it to whatever the operator already has.
 *
 * KNOWN-UNCOVERED (registered honestly — the well is NOT "full"):
 *   - CI / deploy rollback signals (OutcomeSignalSource.CI) — needs a webhook.
 *   - Partial reversals — only exact full reversals match a patch-id.
 *   - A PR whose subject does not end with `(#N)` and has no mergeCommitSha is
 *     unresolvable, so its reverts are not swept here.
 *
 * The agent is NOT in the write loop: inputs are git commit topology and the
 * task's delivery shas only. No self-report field exists.
 *
 *   npx tsx scripts/detect-git-outcome-rejections.ts [--dry-run] [--task LUM-N] [--since 2026-06-01] [--limit N]
 */
import { execFileSync } from 'child_process'
import { prisma } from '@/lib/db/prisma'
import { gitOutcomeRecorder } from '@/lib/services/outcome/git-outcome-recorder'
import {
  detectGitRejections,
  type GitRejectionSignal,
} from '@/lib/services/outcome/git-referent-detector'

export function parseArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f)
    return i >= 0 ? (argv[i + 1] ?? null) : null
  }
  const limit = get('--limit')
  return {
    dryRun: argv.includes('--dry-run'),
    task: get('--task'),
    since: get('--since'),
    limit: limit ? Number(limit) : null,
    // --deep runs the full per-delivery detector (both mechanisms, incl. the
    // O(files×downstream) patch-reversal) over EVERY delivery. Without it the
    // bulk run uses a cheap formal-revert pre-filter (one git pass) and only
    // examines deliveries that some commit formally reverts — fast, and the only
    // mechanism the webhook feed has anyway. Use --deep for an occasional sweep
    // that also catches trailer-less hand-reverts (patch-id reversal).
    deep: argv.includes('--deep'),
  }
}

const RS = '\x1e' // record separator
const TRAILER_RE = /This reverts commit ([0-9a-f]{40})/g

/**
 * One cheap `git log origin/main` pass → the set of every commit sha that some
 * later commit FORMALLY reverts (a `This reverts commit <sha>` trailer). A
 * delivery whose sha is in this set is the only kind the formal-revert detector
 * can flag, so it pre-filters the expensive per-delivery scan down to the few
 * deliveries that could possibly be REJECTED-by-trailer.
 */
function globallyRevertedShas(): Set<string> {
  const out = execFileSync(
    'git',
    [
      'log',
      'origin/main',
      '-F',
      '--grep',
      'This reverts commit',
      `--format=%b${RS}`,
    ],
    { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }
  )
  const set = new Set<string>()
  for (const m of out.matchAll(TRAILER_RE)) set.add(m[1]!)
  return set
}

/**
 * One delivery commit on a DONE task — the per-PR unit the detector scans.
 * Per-PR, NOT grouped by task: a task may carry a delivery AND a later
 * re-delivery after a revert (e.g. LUM-587 #715 then #716). Grouping both shas
 * into one DeliveryRef would make the revert an ancestor of the excluded
 * re-delivery, hiding it from the scan. One sha per PR keeps each scan honest.
 */
export interface Delivery {
  taskId: string
  workspaceId: string
  identifier: string
  prNumber: number
  sha: string
}

interface PrRow {
  taskId: string | null
  workspaceId: string
  number: number
  mergeCommitSha: string | null
  task: { number: number; team: { identifier: string } } | null
}

const FS = '\x1f' // field separator between %H and %s

/**
 * Index PR number → delivery commit sha from one `git log origin/main` pass.
 * The delivery commit of squash-merged PR #N is the commit whose SUBJECT ENDS
 * with `(#N)` — precise enough to skip a `Revert "… (#N)"` (its subject ends
 * with `"`) and a later PR `(#M)`. Pure: takes the raw `%H<FS>%s\n` log.
 */
export function buildDeliveryShaIndex(logOutput: string): Map<number, string> {
  const index = new Map<number, string>()
  for (const line of logOutput.split('\n')) {
    const [sha, subject = ''] = line.split(FS)
    if (!sha) continue
    const m = subject.match(/\(#(\d+)\)\s*$/)
    if (!m) continue
    const num = Number(m[1])
    // First (newest) wins; PR numbers are unique, so there is only one anyway.
    if (!index.has(num)) index.set(num, sha)
  }
  return index
}

/**
 * Resolve each merged PR on a DONE task to ONE delivery commit: its stored
 * mergeCommitSha when present, else the git-derived sha for its PR number. A PR
 * with no resolvable sha is dropped (INCONCLUSIVE — no delivery commit to scan).
 */
export function resolveDeliveries(
  prs: PrRow[],
  shaIndex: Map<number, string>
): Delivery[] {
  const out: Delivery[] = []
  for (const pr of prs) {
    if (!pr.taskId || !pr.task) continue
    const sha = pr.mergeCommitSha ?? shaIndex.get(pr.number) ?? null
    if (!sha) continue
    out.push({
      taskId: pr.taskId,
      workspaceId: pr.workspaceId,
      identifier: `${pr.task.team.identifier}-${pr.task.number}`,
      prNumber: pr.number,
      sha,
    })
  }
  return out
}

/** One `git log origin/main` pass: `<sha><FS><subject>` per line. */
function gitLogSubjects(): string {
  return execFileSync('git', ['log', 'origin/main', `--format=%H${FS}%s`], {
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

async function main(argv: string[]): Promise<number> {
  const { config: loadEnv } = await import('dotenv')
  loadEnv({ path: '.env.local' })

  const args = parseArgs(argv)

  const where: Record<string, unknown> = {
    state: 'merged',
    taskId: { not: null },
    task: { status: 'DONE' },
  }
  if (args.since) where.mergedAt = { gte: new Date(args.since) }
  if (args.task) {
    const [team, num] = args.task.split('-')
    if (team && num)
      where.task = {
        status: 'DONE',
        number: Number(num),
        team: { identifier: team },
      }
  }

  const prs = await prisma.pullRequest.findMany({
    where,
    orderBy: { mergedAt: 'desc' },
    select: {
      taskId: true,
      workspaceId: true,
      number: true,
      mergeCommitSha: true,
      task: {
        select: { number: true, team: { select: { identifier: true } } },
      },
    },
  })

  const shaIndex = buildDeliveryShaIndex(gitLogSubjects())
  const resolved = resolveDeliveries(prs, shaIndex)

  // Bulk runs pre-filter to deliveries some commit formally reverts (cheap, one
  // git pass) — the only kind the trailer detector can flag. --deep skips the
  // pre-filter to also patch-id-scan for trailer-less hand-reverts (expensive).
  const preFiltered = args.deep
    ? resolved
    : (() => {
        const reverted = globallyRevertedShas()
        return resolved.filter(d => reverted.has(d.sha))
      })()
  const skippedByPrefilter = resolved.length - preFiltered.length

  let deliveries = preFiltered
  if (args.limit) deliveries = deliveries.slice(0, args.limit)

  let rejected = 0
  let inserted = 0
  let inconclusive = 0
  for (const d of deliveries) {
    try {
      if (args.dryRun) {
        const signals: GitRejectionSignal[] = detectGitRejections({
          identifier: d.identifier,
          shas: [d.sha],
        })
        if (signals.length > 0) {
          rejected++
          for (const s of signals)
            process.stdout.write(
              `REJECTED ${d.identifier} (PR #${d.prNumber})  ${s.kind} (${s.mechanism}) ${s.revertingSha.slice(0, 8)} reverts ${s.revertedSha.slice(0, 8)}\n`
            )
        } else {
          inconclusive++
        }
        continue
      }
      const res = await gitOutcomeRecorder.recordGitRejections({
        workspaceId: d.workspaceId,
        taskId: d.taskId,
        delivery: { identifier: d.identifier, shas: [d.sha] },
      })
      if (res.signals.length > 0) rejected++
      else inconclusive++
      inserted += res.inserted
      for (const s of res.signals)
        process.stdout.write(
          `${res.inserted ? 'RECORDED' : 'KNOWN'} ${d.identifier} (PR #${d.prNumber})  ${s.kind} (${s.mechanism}) ${s.revertingSha.slice(0, 8)}\n`
        )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      process.stderr.write(`SKIP ${d.identifier} (PR #${d.prNumber}): ${msg}\n`)
    }
  }

  const prefilterNote = args.deep
    ? ' (--deep: full patch-id scan, no pre-filter)'
    : ` (+${skippedByPrefilter} pre-filtered out: no formal revert)`
  process.stdout.write(
    `\nScanned ${deliveries.length} deliveries${prefilterNote}: ${rejected} REJECTED, ${inconclusive} INCONCLUSIVE` +
      `${args.dryRun ? ' (dry-run, nothing written)' : `, ${inserted} new signal(s) recorded`}\n`
  )
  return 0
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
    .finally(() => prisma.$disconnect())
}

export { main }
