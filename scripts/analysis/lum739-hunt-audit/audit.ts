/**
 * LUM-739 — hunt audit (spec §6 L3 "Verify" step 4, §12 R2).
 *
 * READ-ONLY — no writes. Reports, over every scan whose `stages` carries a
 * `hunt` key: per-state counts, candidates, mechanical rejections by reason,
 * the falsifier REJECT rate, the INCONCLUSIVE → FALSE_POSITIVE disposition
 * rate, and token spend. These two rates are the precondition for ever
 * letting an LLM_JUDGE finding block DONE (policy table, LUM-740).
 *
 * Run:
 *   DOTENV_CONFIG_PATH="$(pwd)/.env.production" npx tsx -r dotenv/config scripts/analysis/lum739-hunt-audit/audit.ts
 */
import { prisma } from '../../../lib/db/prisma'
import {
  aggregateHuntAudit,
  formatShellDetail,
  type HuntScanRow,
  type ShellDetailTask,
} from './aggregate'

function pct(n: number | null): string {
  return n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

async function main(): Promise<void> {
  const scans = await prisma.prSecurityScan.findMany({
    where: { stages: { path: ['hunt'], not: 'null' } },
    select: {
      id: true,
      stages: true,
      huntAudit: true,
      tokenSpent: true,
      findings: {
        select: {
          ruleId: true,
          provenance: true,
          disposition: true,
          falsifierVerdict: true,
        },
      },
    },
  })
  /** How many task rows get the command-by-command listing. */
  const SHELL_DETAIL_TASKS = 6

  const stats = aggregateHuntAudit(scans as unknown as HuntScanRow[])

  console.log('=== LUM-739 hunt audit ===')
  console.log(`scans with a hunt layer: ${stats.scans}`)
  for (const [state, n] of Object.entries(stats.hunt)) {
    console.log(`  ${state.padEnd(8)} ${String(n).padStart(6)}`)
  }
  console.log('')
  console.log('=== Hunt → mechanical gate ===')
  console.log(`candidates submitted:   ${stats.candidates}`)
  console.log(`mechanically rejected:  ${stats.mechanicalRejected}`)
  for (const [reason, n] of Object.entries(stats.rejectReasons).sort(
    (a, b) => b[1] - a[1]
  )) {
    console.log(`  ${reason.padEnd(28)} ${String(n).padStart(6)}`)
  }
  console.log('')
  console.log('=== Falsifier ===')
  console.log(`REJECT:        ${stats.falsifierRejects}`)
  console.log(
    `INCONCLUSIVE:  ${stats.inconclusive} (persisted as advisory findings)`
  )
  console.log(`REJECT rate:   ${pct(stats.falsifierRejectRate)}`)
  console.log('')
  console.log('=== Human dispositions on INCONCLUSIVE findings ===')
  console.log(`FALSE_POSITIVE: ${stats.falsePositive}`)
  console.log(`ACCEPTED_RISK:  ${stats.acceptedRisk}`)
  console.log(
    `INCONCLUSIVE → FALSE_POSITIVE rate: ${pct(stats.inconclusiveToFalsePositiveRate)}`
  )
  console.log('')
  console.log('=== Tokens ===')
  console.log(
    `metered scans: ${stats.tokenSpent.measured} / ${stats.scans} · total ${stats.tokenSpent.total} tokens`
  )
  const mean =
    stats.tokenSpent.measured === 0
      ? null
      : Math.round(stats.tokenSpent.total / stats.tokenSpent.measured)
  console.log(`mean per metered scan: ${mean ?? 'n/a'} (§9 target ≤ 60000)`)

  // LUM-758. Everything below was persisted from the first day of the task
  // graph and read by nothing, which is why "watch it in the first week's
  // data" could not happen. Rows that pre-date the task graph carry none of
  // these fields and are simply absent here — never counted as zeros.
  console.log('')
  console.log('=== Plan (LUM-758) ===')
  const by = stats.plan.by
  console.log(
    `by: model ${by.model} · fallback ${by.fallback} · not-attempted ${by.notAttempted}` +
      (by.unknown > 0 ? ` · unknown ${by.unknown}` : '')
  )
  const counts = Object.keys(stats.plan.taskCounts).sort()
  console.log(
    `tasks planned: ${
      counts.length === 0
        ? '(no task-graph scans yet)'
        : counts.map(k => `${k}→${stats.plan.taskCounts[k]}`).join(' · ')
    }`
  )
  // LUM-766 follow-up / LUM-776 — why the planner failed, two ways: by the
  // provider's finish reason (budget vs shape) and by the stable shape the
  // acceptance read-out counts on. `unclassified` = rows older than the field.
  const fails = Object.entries(stats.plan.failures).sort((a, b) => b[1] - a[1])
  const shapes = Object.entries(stats.plan.failureShapes).sort(
    (a, b) => b[1] - a[1]
  )
  console.log(
    `plan failures by finish reason: ${fails.length === 0 ? '(none)' : fails.map(([k, n]) => `${k} ${n}`).join(' · ')}` +
      (stats.plan.emptyOutput > 0
        ? ` · emitted nothing ${stats.plan.emptyOutput}`
        : '')
  )
  console.log(
    `plan failures by shape (LUM-776): ${shapes.length === 0 ? '(none)' : shapes.map(([k, n]) => `${k} ${n}`).join(' · ')}`
  )
  const repaired = Object.entries(stats.plan.repaired).sort(
    (a, b) => b[1] - a[1]
  )
  console.log(
    `model plans that needed an envelope repair (LUM-776): ${repaired.length === 0 ? '(none)' : repaired.map(([k, n]) => `${k} ${n}`).join(' · ')}`
  )
  const stops = Object.entries(stats.taskStops).sort((a, b) => b[1] - a[1])

  console.log(
    `task stops: ${stops.length === 0 ? '(none)' : stops.map(([k, n]) => `${k} ${n}`).join(' · ')}`
  )
  // The convergence read. `done` = the agent decided to submit; `wrapped up` =
  // it was asked because a counter ran out. All-wrapped-up is a layer whose
  // agent never decides — the thing neither budget nor context has moved.
  console.log(
    `submitted on its own: ${stats.taskStops.done ?? 0} / ${stats.tasksRan} tasks that ran · wrapped up: ${stats.tasksWrappedUp}${stats.tasksWrapUpRefused > 0 ? ` · wrap-up refused by provider: ${stats.tasksWrapUpRefused}` : ''}`
  )

  const sh = stats.shell
  if (sh.calls > 0) {
    const of = (n: number, d: number) =>
      d > 0 ? `${n} (${((n / d) * 100).toFixed(0)}%)` : String(n)
    // `empty` is a rate among commands that RAN — dividing it by every request
    // would quietly shrink it in exactly the runs where the gate refused most.
    const ran = sh.calls - sh.refused - sh.failed
    console.log(
      `shell: ${sh.calls} commands · refused by the gate ${of(sh.refused, sh.calls)} · sandbox failed ${of(sh.failed, sh.calls)} · of the ${ran} that ran, returned nothing ${of(sh.empty, ran)} · ${sh.outputChars} chars back`
    )
  }
  // LUM-758 follow-up — the per-task detail. The run-level line above says
  // HOW MUCH; only this says WHAT, and telling "mapped the repo and ran out"
  // from "the gate rejected everything" from "looked and found nothing" is the
  // entire reason the field exists. Newest scan first, and only tasks that
  // actually asked the shell for something.
  const detailLines = formatShellDetail(
    (scans as unknown as HuntScanRow[]).flatMap(r => {
      const a = (r.huntAudit ?? {}) as { tasks?: ShellDetailTask[] }
      return a.tasks ?? []
    }),
    SHELL_DETAIL_TASKS
  )
  if (detailLines.length > 0) {
    console.log('')
    console.log('=== What the agents actually ran (LUM-758) ===')
    for (const l of detailLines) console.log(`  ${l}`)
  }

  console.log('')
  console.log('=== Sandbox (LUM-758) ===')
  console.log(
    `attached ${stats.sandbox.attached} · created ${stats.sandbox.created} · ran with egress open ${stats.sandbox.egressOpen}`
  )

  console.log('')
  console.log('=== Compression (LUM-758 §6.3) ===')
  const c = stats.compress
  if (c.scans === 0) {
    console.log('no scan recorded a compression')
  } else {
    console.log(
      `scans ${c.scans} · usable calls ${c.calls} · NO-OP calls ${c.noOpCalls} · ${c.tokens} tokens`
    )
    console.log(
      `chars: ${c.inputChars} in → ${c.outputChars} out (saving is in CHARACTERS; the price above is TOKENS — divide by ~4 before comparing)`
    )
    if (c.noOpCalls > 0 && c.calls === 0) {
      console.log(
        `⚠ every compression produced nothing usable. The hunt model saw none of the ${c.noOpCalls} command outputs it asked for, so \`candidates: 0\` on these scans says nothing about the layer.`
      )
    }
  }
}

main()
  .catch(err => {
    console.error('[lum739] fatal:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
