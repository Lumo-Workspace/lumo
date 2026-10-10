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
 * Read-only invariant (mirrors scripts/boundary-fp-rate.ts): no DB, no writes,
 * no network. The LLM confirmation layer is a
 * deterministic stub judge by default; `--live` swaps in the real model client
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
} from '@/ee/private/boundary-crossing/align-eval'

async function resolveJudges(live: boolean): Promise<EvalJudges> {
  if (!live) return STUB_JUDGES
  // Lazy-import the real model clients ONLY on --live so the default path never
  // pulls in the `ai` SDK (and never hits the network).
  const { confirmActionExecuted } =
    await import('@/ee/security/llm/action-confirm-client')
  return { action: confirmActionExecuted }
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
