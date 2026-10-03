/**
 * Zero-match guard for jest test-name checkpointers (LUM-405 follow-up).
 *
 * Problem: `npx jest -t '<name>'` exits 0 even when the pattern matches NO
 * test (everything reported as skipped) — so a by-name test command (e.g. a
 * `lumo task testcase` command) written that way silently fake-PASSes the
 * moment the test is renamed or deleted (measured on this repo: 5782
 * skipped, 0 matched, exit 0).
 * Same trap class as the BSD-grep `-P` fake-PASS incident (LUM-401).
 *
 * Fix: run jest through this wrapper instead. It runs
 * `jest -t '<name>' --json [extra jest args…]` and exits 0 ONLY when at least
 * one matching test ran and passed and none failed. Zero matches = exit 1.
 *
 * Usage:
 *   npx tsx scripts/jest-t.ts '<exact test name>' [test file path…]
 *
 * Passing the test file path as an extra arg scopes the run (much faster than
 * letting jest filter the whole suite by name).
 */
import { execFileSync } from 'child_process'

export type JestCounts = {
  numPassedTests: number
  numFailedTests: number
}

export type Verdict = {
  ok: boolean
  summary: string
}

/**
 * Pure core: decide PASS/FAIL from jest's --json counters.
 * PASS requires ≥1 matched-and-passed test and zero failures — a zero-match
 * run (renamed/deleted test) is a FAIL, never a silent PASS.
 */
export function evaluateJestCounts(
  counts: JestCounts,
  pattern: string
): Verdict {
  const { numPassedTests, numFailedTests } = counts
  if (numFailedTests > 0) {
    return {
      ok: false,
      summary: `jest-t: ${numFailedTests} failed (pattern "${pattern}")`,
    }
  }
  if (numPassedTests === 0) {
    return {
      ok: false,
      summary:
        `jest-t: ZERO tests matched pattern "${pattern}" — the test was ` +
        `renamed or deleted; a bare \`jest -t\` would have fake-PASSed here.`,
    }
  }
  return {
    ok: true,
    summary: `jest-t: ${numPassedTests} passed, 0 failed (pattern "${pattern}")`,
  }
}

/**
 * Extract the jest --json result object from stdout. Jest writes the JSON to
 * stdout but other tooling may prepend/append noise — take the outermost
 * braces. Throws if no JSON object is present.
 */
export function extractJestJson(stdout: string): JestCounts {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('jest-t: no JSON object found in jest output')
  }
  const parsed: unknown = JSON.parse(stdout.slice(start, end + 1))
  const obj = parsed as Partial<JestCounts>
  if (
    typeof obj.numPassedTests !== 'number' ||
    typeof obj.numFailedTests !== 'number'
  ) {
    throw new Error('jest-t: jest JSON output missing test counters')
  }
  return {
    numPassedTests: obj.numPassedTests,
    numFailedTests: obj.numFailedTests,
  }
}

/** Run jest with --json and return its stdout regardless of exit code. */
export function runJest(pattern: string, extraArgs: string[]): string {
  try {
    return execFileSync(
      'npx',
      ['jest', '-t', pattern, '--json', ...extraArgs],
      { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
    )
  } catch (e) {
    // Failing tests make jest exit non-zero; the JSON is still on stdout.
    const stdout = (e as { stdout?: string | Buffer }).stdout
    if (stdout) return stdout.toString()
    throw e
  }
}

export function main(argv: string[]): number {
  const [pattern, ...extraArgs] = argv
  if (!pattern || !pattern.trim()) {
    process.stderr.write(
      'usage: npx tsx scripts/jest-t.ts <testNamePattern> [jest args…]\n'
    )
    return 1
  }
  let verdict: Verdict
  try {
    verdict = evaluateJestCounts(
      extractJestJson(runJest(pattern, extraArgs)),
      pattern
    )
  } catch (e) {
    process.stderr.write(`jest-t: ${(e as Error).message}\n`)
    return 1
  }
  process.stderr.write(verdict.summary + '\n')
  return verdict.ok ? 0 : 1
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('jest-t.ts')) {
  process.exit(main(process.argv.slice(2)))
}
