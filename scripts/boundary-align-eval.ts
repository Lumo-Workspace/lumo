/**
 * LUM-468 — boundary-detector alignment eval (control-eval) runner.
 *
 * Standalone, read-only, fixture-only. Runs the labeled gold corpus through the
 * REAL detection pipeline and prints a precision / recall + per-category
 * TP/FN/FP/TN report, then enforces the recall regression guard (every
 * non-evasion positive must be flagged). Exits 1 if the recall guard trips, so
 * it can gate CI; the evasion subset is reported as a separate best-effort metric
 * and never fails the run.
 *
 * Read-only invariant (mirrors scripts/boundary-fp-rate.ts, scripts/checkpointer-
 * drift.ts): no DB, no writes, no network. The two LLM confirmation layers are
 * deterministic stub judges by default; `--live` swaps in the real model clients
 * (lazy-imported only on that flag) for an optional real-prompt run.
 *
 *   npx tsx scripts/boundary-align-eval.ts            # deterministic (default)
 *   npx tsx scripts/boundary-align-eval.ts --live     # real LLM confirmation
 */
import {
  runAlignEval,
  recallGuard,
  formatReport,
  STUB_JUDGES,
  GOLD_CORPUS,
  type EvalJudges,
} from '@/lib/boundary-crossing/align-eval'

async function resolveJudges(live: boolean): Promise<EvalJudges> {
  if (!live) return STUB_JUDGES
  // Lazy-import the real model clients ONLY on --live so the default path never
  // pulls in the `ai` SDK (and never hits the network).
  const [
    { confirmActionExecuted },
    { judgeTestTampering },
    { judgeInfraKill },
  ] = await Promise.all([
    import('@/lib/llm/action-confirm-client'),
    import('@/lib/llm/test-tampering-judge-client'),
    import('@/lib/llm/infra-kill-judge-client'),
  ])
  return {
    action: confirmActionExecuted,
    tampering: judgeTestTampering,
    infraKill: judgeInfraKill,
  }
}

export async function main(argv: string[]): Promise<number> {
  const live = argv.includes('--live')
  const judges = await resolveJudges(live)
  const report = await runAlignEval(GOLD_CORPUS, judges)
  process.stdout.write(formatReport(report))

  const guard = recallGuard(report)
  if (!guard.ok) {
    process.stderr.write(
      `\n✗ recall guard FAILED — ${guard.slipped.length} non-evasion real ` +
        `crossing(s) slipped:\n`
    )
    for (const s of guard.slipped) {
      process.stderr.write(`    ✗ [${s.category}] ${s.label}\n`)
    }
    return 1
  }
  // LUM-836: a gold item's expected severity (e.g. a self-started dev-server
  // kill lowered to LOW, an infrastructure kill kept HIGH) must hold.
  if (report.severityMismatches.length > 0) {
    process.stderr.write(
      `\n✗ ${report.severityMismatches.length} severity expectation(s) failed\n`
    )
    return 1
  }
  process.stderr.write(
    `\n✓ recall guard: ${(guard.recall * 100).toFixed(0)}% of non-evasion ` +
      `positives flagged — no real crossing slipped\n`
  )
  return 0
}

// Run only when invoked directly (not when imported by a test).
if (require.main === module) {
  main(process.argv.slice(2))
    .then(code => process.exit(code))
    .catch(err => {
      process.stderr.write(`boundary-align-eval: ${err?.message ?? err}\n`)
      process.exit(1)
    })
}
