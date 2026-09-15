/**
 * LUM-785 — checkpointer for Lumo's own semgrep rules
 * (`security/semgrep-rules/*.yaml` + their `*.ts` fixtures).
 *
 * Runs `semgrep --test --json` over the rules directory and exits 0 ONLY when
 * every rule has a fixture, every fixture check passed and no config error was
 * reported. Fails loudly — never fake-passes — when semgrep is not installed
 * (`uv tool install semgrep==<SEMGREP_VERSION>` puts it on PATH) or when the
 * output cannot be parsed. `semgrep --test` itself exits 0 on failed checks,
 * which is why the JSON is read instead of the exit code.
 */
/* eslint-disable no-console -- CLI checkpointer: its output IS the verdict */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const RULES_DIR = resolve(process.cwd(), 'security/semgrep-rules')

interface TestJson {
  config_missing_tests?: string[]
  config_with_errors?: Array<{ filename?: string; error?: string }>
  results?: Record<
    string,
    {
      checks?: Record<
        string,
        {
          passed?: boolean
          matches?: Record<
            string,
            { expected_lines?: number[]; reported_lines?: number[] }
          >
          errors?: unknown[]
        }
      >
    }
  >
}

/** Pure — exported for the unit test. Returns the failure reasons; empty = pass. */
export function evaluateSemgrepTest(json: TestJson): string[] {
  const problems: string[] = []
  for (const f of json.config_missing_tests ?? []) {
    problems.push(`rule file has no fixture: ${f}`)
  }
  for (const e of json.config_with_errors ?? []) {
    problems.push(`config error in ${e.filename ?? '?'}: ${e.error ?? '?'}`)
  }
  let checks = 0
  for (const [file, result] of Object.entries(json.results ?? {})) {
    for (const [ruleId, check] of Object.entries(result.checks ?? {})) {
      checks += 1
      if (check.passed !== true) {
        const detail = Object.values(check.matches ?? {})
          .map(
            m =>
              `expected ${JSON.stringify(m.expected_lines ?? [])} reported ${JSON.stringify(m.reported_lines ?? [])}`
          )
          .join('; ')
        problems.push(
          `${file} › ${ruleId}: FAILED (${detail || 'no match data'})`
        )
      }
      if ((check.errors ?? []).length > 0) {
        problems.push(`${file} › ${ruleId}: ${check.errors!.length} error(s)`)
      }
    }
  }
  if (checks === 0) problems.push('no rule checks ran (empty results)')
  return problems
}

function main(): number {
  if (!existsSync(RULES_DIR)) {
    console.error(`[semgrep-rules-test] rules dir missing: ${RULES_DIR}`)
    return 1
  }
  const run = spawnSync(
    'semgrep',
    ['--test', '--config', RULES_DIR, RULES_DIR, '--metrics=off', '--json'],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
  )
  if (run.error) {
    console.error(
      `[semgrep-rules-test] could not run semgrep (${run.error.message}). ` +
        'Install it with: uv tool install semgrep==<SEMGREP_VERSION from lib/services/security-managed-scan.config.ts>'
    )
    return 1
  }
  let parsed: TestJson
  try {
    parsed = JSON.parse(run.stdout) as TestJson
  } catch {
    console.error(
      `[semgrep-rules-test] semgrep --test produced no JSON (exit ${run.status}):\n${run.stderr.slice(-2000)}`
    )
    return 1
  }
  const problems = evaluateSemgrepTest(parsed)
  const ruleCount = Object.values(parsed.results ?? {}).reduce(
    (n, r) => n + Object.keys(r.checks ?? {}).length,
    0
  )
  if (problems.length > 0) {
    console.error(`[semgrep-rules-test] FAIL — ${problems.length} problem(s):`)
    for (const p of problems) console.error(`  - ${p}`)
    return 1
  }
  console.log(
    `[semgrep-rules-test] PASS — ${ruleCount} rule(s) matched their fixtures exactly`
  )
  return 0
}

if (require.main === module) process.exit(main())
