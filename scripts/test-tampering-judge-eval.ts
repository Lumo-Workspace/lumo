/**
 * TEST_TAMPERING LLM-judge reliability eval (LUM-463 criterion 4) — read-only,
 * no DB. Runs the k-run consistency harness against the labelled fixture set
 * using the REAL judge (the gateway), and prints the recorded agreement so the
 * judge's reliability is measured before it is trusted to downgrade a crossing
 * (pass^k discipline). A runnable script, deliberately NOT a `lumo` subcommand
 * (touches no `cli/src/commands/**`, so no SKILL.md-sync duty — mirrors
 * scripts/boundary-fp-rate.ts).
 *
 * The unit checkpointer (lum463-judge-consistency.test.ts) exercises the same
 * harness with a mock judge; this script is the offline run that records real
 * model variance. It calls the gateway, so it needs gateway credentials in the
 * environment and is never run as part of the jest suite.
 *
 * Usage:
 *   npx tsx scripts/test-tampering-judge-eval.ts [--k N]
 *     --k N   runs per fixture (default 5)
 */
import { evaluateJudgeConsistency } from '@/lib/boundary-crossing/judge-consistency'
import { JUDGE_CONSISTENCY_FIXTURES } from '@/lib/boundary-crossing/judge-fixtures'
import { judgeTestTampering } from '@/lib/llm/test-tampering-judge-client'

const DEFAULT_K = 5

function parseK(argv: string[]): number {
  const i = argv.indexOf('--k')
  if (i === -1) return DEFAULT_K
  const raw = argv[i + 1]
  const n = raw != null ? Number.parseInt(raw, 10) : NaN
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`--k expects a positive integer, got "${raw ?? ''}"`)
  }
  return n
}

export async function main(argv: string[]): Promise<number> {
  const k = parseK(argv)
  const report = await evaluateJudgeConsistency(
    JUDGE_CONSISTENCY_FIXTURES,
    k,
    judgeTestTampering
  )
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`
  const lines: string[] = [
    `TEST_TAMPERING judge consistency — k=${report.k}, ${report.fixtures} fixtures`,
    `  unanimous (pass^k): ${pct(report.unanimousRate)}`,
    `  accuracy (majority vs label): ${pct(report.accuracy)}`,
    '',
  ]
  for (const f of report.perFixture) {
    const mark = f.matchedExpected ? '✓' : '✗'
    lines.push(
      `  ${mark} [${f.expected}] ${f.name}\n      runs=${f.runs.join(',')} agreement=${pct(f.agreement)}`
    )
  }
  process.stdout.write(`${lines.join('\n')}\n`)
  return 0
}

// Run only when invoked as a script (never when imported by tests).
if (
  process.argv[1] &&
  process.argv[1].endsWith('test-tampering-judge-eval.ts')
) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(
        `test-tampering-judge-eval: ${(err as Error).message}\n`
      )
      process.exit(1)
    }
  )
}
