/**
 * LUM-772 backfill: re-judge the OPEN PROJECT_RULE_VIOLATION crossings a
 * compiled policy rule produced against the CURRENT compiler's view of the
 * stored policy, and rule the ones it would no longer produce FALSE_POSITIVE.
 *
 * Two compiler bugs left real work stamped as rule violations that block
 * DONE until a human rules on each: the target-blind `cmd-substr: "git push"`
 * a "never push to main / develop" rule compiled to (this task — every
 * feature-branch push tripped it), and the LUM-770 obligation-as-prohibition
 * ("tests + `npx tsc --noEmit` pass" → every PR opened tripped it). The fix is
 * deterministic, so the rows it would no longer produce are ruled the same
 * way, with the note saying exactly why (lib/boundary-crossing/rejudge).
 *
 * Judgement is on the hook event's FULL command when it is on record; a
 * clipped `detail` alone is never judged (left open, reported). Rows that
 * still match, or whose project has no stored policy, are left open.
 *
 * Dry-run by default; pass --apply to write. Each applied row gets
 * `disposition = FALSE_POSITIVE`, no human actor, the backfill note, and a
 * BOUNDARY_CROSSING_DISPOSITIONED audit row stamped `channel: 'SYSTEM'`.
 * Production: run only with explicit per-session authorization against the
 * prod DB URL from the MAIN checkout (`.env.production` is gitignored and
 * absent in worktrees):
 *
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/backfill-prv-rejudge.ts --rule <policyRuleRef> [--rule …]            # dry-run
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config \
 *     scripts/backfill-prv-rejudge.ts --rule <policyRuleRef> --apply             # write
 */
import 'dotenv/config'
import { prisma } from '@/lib/db/prisma'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { projectPolicyRepository } from '@/ee/security/repositories/project-policy.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import {
  compileRuleSet,
  COMPILER_VERSION,
} from '@/ee/security/services/policy/policy-compiler.service'
import type { PolicyRule } from '@/ee/security/services/policy/types'
import {
  backfillNote,
  parseBackfillArgs,
  planRuleRejudge,
  type RejudgeDecision,
  type RejudgeRow,
} from '@/lib/boundary-crossing/rejudge'

function short(s: string, n = 140): string {
  const t = s.replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n)}…` : t
}

function printDecision(d: RejudgeDecision): void {
  console.log(
    `  ${d.verdict.padEnd(17)} ${d.row.id} task=${d.row.taskId ?? '-'} :: ${short(d.command ?? d.row.detail)}`
  )
}

async function main() {
  const { ruleRefs, apply } = parseBackfillArgs(process.argv.slice(2))

  const rows: RejudgeRow[] = []
  for (const ref of ruleRefs) {
    const open = await boundaryCrossingRepository.findOpenByPolicyRuleRef(ref)
    const commands = await hookEventRepository.findCommandsByIds(
      open.map(r => r.hookEventId).filter((id): id is string => id != null)
    )
    for (const r of open) {
      rows.push({
        id: r.id,
        taskId: r.taskId,
        projectId: r.task?.projectId ?? null,
        policyRuleRef: ref,
        policyRuleText: r.policyRuleText,
        detail: r.detail,
        command:
          r.hookEventId != null ? (commands.get(r.hookEventId) ?? null) : null,
      })
    }
  }
  console.log(
    `${rows.length} OPEN PROJECT_RULE_VIOLATION row(s) cite ${ruleRefs.join(', ')}`
  )

  // The current compiler's view of each project's STORED policy — the same
  // deterministic post-processing the service applies, no model call.
  const rulesByProject = new Map<string, PolicyRule[]>()
  for (const projectId of new Set(
    rows.map(r => r.projectId).filter((p): p is string => p != null)
  )) {
    const stored = await projectPolicyRepository.latestForProject(projectId)
    if (stored) rulesByProject.set(projectId, compileRuleSet(stored.rules))
  }

  const plan = planRuleRejudge(rows, rulesByProject)
  console.log(`\nWould rule FALSE_POSITIVE (${plan.candidates.length}):`)
  for (const d of plan.candidates) printDecision(d)
  console.log(`\nLeft open (${plan.leftOpen.length}):`)
  for (const d of plan.leftOpen) printDecision(d)

  if (!apply) {
    console.log(
      '\n[dry-run] nothing written. Re-run with --apply to rule the candidates.'
    )
    await prisma.$disconnect()
    return
  }

  const now = new Date()
  let written = 0
  for (const d of plan.candidates) {
    const note = backfillNote(d, COMPILER_VERSION)
    await boundaryCrossingRepository.disposition(
      d.row.id,
      'FALSE_POSITIVE',
      note,
      null,
      now
    )
    if (d.row.taskId) {
      await activityRepository.create({
        taskId: d.row.taskId,
        actorId: null,
        type: 'BOUNDARY_CROSSING_DISPOSITIONED',
        payload: {
          boundaryCrossingId: d.row.id,
          category: 'PROJECT_RULE_VIOLATION',
          detail: d.row.detail,
          from: null,
          to: 'FALSE_POSITIVE',
          disposition: 'FALSE_POSITIVE',
          note,
          channel: 'SYSTEM',
          backfill: 'LUM-772',
          verdict: d.verdict,
        },
      })
    }
    written += 1
  }
  console.log(`\nruled ${written} row(s) FALSE_POSITIVE`)
  await prisma.$disconnect()
}

main().catch(async error => {
  console.error(error)
  await prisma.$disconnect()
  process.exit(1)
})
