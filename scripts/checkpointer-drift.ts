/**
 * Checkpointer drift detector (LUM-436).
 *
 * Problem. `scripts/jest-t.ts` fails a jest-by-name checkpointer the instant its
 * test is renamed or deleted (zero match) — but only when the checkpointer is
 * RUN. A PASS recorded against a MACHINE criterion before the rename stays on
 * the books; the task sits in DONE and the stale checkpointer is invisible until
 * something re-verifies it. The rename frequently happens in a *different*
 * task's work (the canonical case: #528 renamed a test owned by LUM-433's
 * contract), so a bound-task re-verify never re-runs it. The zero-match guard
 * lives at the *test-run* layer; this detector lifts it to the *stored-contract*
 * layer.
 *
 * What it does. Given a contract's criteria, it resolves each MACHINE
 * checkpointer STATICALLY:
 *   - parse the prescribed `npx tsx scripts/jest-t.ts '<name>' <path…>` form
 *     into a test name + one or more file paths;
 *   - confirm at least one path exists AND still contains the test name.
 * A checkpointer that no longer resolves (file gone, or name gone) is `drifted`.
 * One that resolves is `healthy`. Anything that is not a jest-t.ts checkpointer
 * (a bash/git probe, a script invocation) is `skipped` — its resolvability can't
 * be judged statically, and a false-positive "drift" is worse than a miss.
 *
 * Detection-only (the core invariant). This NEVER executes a checkpointer, opens
 * a network connection, POSTs a verdict, or starts/advances a verify round. The
 * pure functions below read repo files and nothing else. The only network call
 * lives in `main()`, and it is a read (`GET …/criteria`) used to *fetch* the
 * contracts to sweep — never a write.
 *
 * Usage (a runnable script, deliberately NOT a `lumo` subcommand — it touches no
 * `cli/src/commands/**` so it carries no SKILL.md-sync obligation):
 *   npx tsx scripts/checkpointer-drift.ts LUM-433 [LUM-N…]   # explicit tasks
 *   npx tsx scripts/checkpointer-drift.ts --mine             # my open contracts
 * Exit 1 if any drift was found, else 0 — so it can gate CI or a pre-merge hook.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type DriftStatus = 'drifted' | 'healthy' | 'skipped'

/** The slice of an acceptance criterion the detector needs. */
export interface CheckpointerCriterion {
  id?: string
  statement?: string
  verifierType?: string
  checkpointer?: string | null
}

/** A jest-t.ts checkpointer parsed into its test name + scoped file paths. */
export interface ParsedJestT {
  name: string
  paths: string[]
}

/** The verdict for a single checkpointer. */
export interface DriftResult {
  status: DriftStatus
  reason: string
  testName?: string
  testPaths?: string[]
}

/**
 * A classified criterion within a swept contract. The optional fields are typed
 * `| undefined` rather than `?` so they are always present on the object (the
 * read-only report has a stable key shape) under `exactOptionalPropertyTypes`.
 */
export interface CriterionDrift {
  taskIdentifier: string
  criterionId: string | undefined
  statement: string | undefined
  status: DriftStatus
  reason: string
  testName: string | undefined
  testPaths: string[] | undefined
}

/** One task's contract handed to the sweep. */
export interface ContractInput {
  taskIdentifier: string
  criteria: CheckpointerCriterion[]
}

/** Sweep output, grouped by verdict. */
export interface SweepReport {
  drifted: CriterionDrift[]
  healthy: CriterionDrift[]
  skipped: CriterionDrift[]
}

/**
 * Split a shell-ish command into tokens, honoring single/double quotes so a
 * quoted test name with spaces stays one token. Quote characters are stripped;
 * we do not interpret escapes or variable expansion (not needed for the
 * prescribed checkpointer form).
 */
function tokenize(cmd: string): string[] {
  const tokens: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  let inToken = false
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inToken = true
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (inToken) {
        tokens.push(cur)
        cur = ''
        inToken = false
      }
      continue
    }
    cur += ch
    inToken = true
  }
  if (inToken) tokens.push(cur)
  return tokens
}

/**
 * Parse a `…/jest-t.ts '<name>' <path…>` checkpointer into its test name and
 * file paths. Returns null for anything that is not a jest-t.ts invocation
 * (bash probes, bare `jest -t`, script calls) — those are not statically
 * resolvable and must never be flagged as drift.
 */
export function parseJestTCheckpointer(
  checkpointer: string
): ParsedJestT | null {
  const tokens = tokenize(checkpointer)
  const idx = tokens.findIndex(t => t.endsWith('jest-t.ts'))
  if (idx === -1) return null
  const name = tokens[idx + 1]
  if (!name) return null
  // Trailing args are the test file path(s); drop any jest flags (`--foo`).
  const paths = tokens.slice(idx + 2).filter(t => !t.startsWith('-'))
  return { name, paths }
}

/** Read a file and report whether it contains the test-name literal. */
function fileContainsName(absPath: string, name: string): boolean {
  try {
    return readFileSync(absPath, 'utf8').includes(name)
  } catch {
    return false
  }
}

/**
 * Statically classify one criterion's checkpointer as drifted / healthy /
 * skipped, reading repo files under `repoRoot`. Pure aside from those reads —
 * it executes nothing and writes nothing.
 */
export function classifyCheckpointer(
  criterion: CheckpointerCriterion,
  repoRoot: string
): DriftResult {
  if (criterion.verifierType !== 'MACHINE') {
    return {
      status: 'skipped',
      reason: 'non-MACHINE criterion — no checkpointer to resolve',
    }
  }
  const cp = criterion.checkpointer
  if (!cp || !cp.trim()) {
    return {
      status: 'skipped',
      reason: 'MACHINE criterion has no checkpointer string',
    }
  }
  const parsed = parseJestTCheckpointer(cp)
  if (!parsed) {
    return {
      status: 'skipped',
      reason:
        'not a jest-t.ts checkpointer — static resolvability not determinable ' +
        '(bash/git/other probe)',
    }
  }
  if (parsed.paths.length === 0) {
    return {
      status: 'skipped',
      reason:
        'jest-t.ts checkpointer carries no test file path — cannot statically ' +
        'scope the resolve',
      testName: parsed.name,
      testPaths: [],
    }
  }
  const existing = parsed.paths.filter(p => existsSync(join(repoRoot, p)))
  if (existing.length === 0) {
    return {
      status: 'drifted',
      reason: `test file(s) not found: ${parsed.paths.join(
        ', '
      )} — renamed, moved, or deleted`,
      testName: parsed.name,
      testPaths: parsed.paths,
    }
  }
  const found = existing.some(p =>
    fileContainsName(join(repoRoot, p), parsed.name)
  )
  if (!found) {
    return {
      status: 'drifted',
      reason: `test "${parsed.name}" not found in ${existing.join(
        ', '
      )} — renamed or deleted`,
      testName: parsed.name,
      testPaths: parsed.paths,
    }
  }
  return {
    status: 'healthy',
    reason: `test "${parsed.name}" resolves in ${existing.join(', ')}`,
    testName: parsed.name,
    testPaths: parsed.paths,
  }
}

/**
 * Sweep one or more contracts, grouping every criterion by drift verdict. Pure
 * over the given contracts (only `classifyCheckpointer`'s repo reads happen).
 */
export function sweepContracts(
  contracts: ContractInput[],
  repoRoot: string
): SweepReport {
  const report: SweepReport = { drifted: [], healthy: [], skipped: [] }
  for (const contract of contracts) {
    for (const criterion of contract.criteria) {
      const r = classifyCheckpointer(criterion, repoRoot)
      const entry: CriterionDrift = {
        taskIdentifier: contract.taskIdentifier,
        criterionId: criterion.id,
        statement: criterion.statement,
        status: r.status,
        reason: r.reason,
        testName: r.testName,
        testPaths: r.testPaths,
      }
      report[r.status].push(entry)
    }
  }
  return report
}

/** Render a sweep report for stdout. */
export function formatReport(report: SweepReport): string {
  const lines: string[] = []
  if (report.drifted.length > 0) {
    lines.push(`✗ ${report.drifted.length} drifted checkpointer(s):`)
    for (const d of report.drifted) {
      const idPart = d.criterionId ? ` ${d.criterionId}` : ''
      lines.push(`  ${d.taskIdentifier}${idPart}: ${d.reason}`)
      if (d.statement) lines.push(`     statement: ${d.statement}`)
    }
  } else {
    lines.push('✓ no drifted checkpointers')
  }
  lines.push(
    `  (${report.healthy.length} healthy, ${report.skipped.length} skipped/unparseable)`
  )
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Runnable sweep (read-only). Kept out of the pure core so importing the
// detector (e.g. from tests) never loads CLI/network code.
// ---------------------------------------------------------------------------

/** Fetch one task's criteria via the read-only CLI API path. */
async function fetchCriteria(
  base: string,
  token: string,
  identifier: string
): Promise<CheckpointerCriterion[]> {
  const res = await fetch(
    `${base}/api/tasks/${encodeURIComponent(identifier)}/criteria`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw new Error(
      `criteria fetch for ${identifier} failed (HTTP ${res.status})`
    )
  }
  const data = (await res.json()) as { criteria: CheckpointerCriterion[] }
  return data.criteria ?? []
}

/** Fetch the caller's not-yet-done task identifiers (the `--mine` sweep set). */
async function fetchMyOpenTaskIdentifiers(
  base: string,
  token: string
): Promise<string[]> {
  const res = await fetch(`${base}/api/tasks/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`task list failed (HTTP ${res.status})`)
  const data = (await res.json()) as {
    tasks: { teamIdentifier?: string; number?: number; status?: string }[]
  }
  return (data.tasks ?? [])
    .filter(t => t.status !== 'done' && t.teamIdentifier && t.number != null)
    .map(t => `${t.teamIdentifier}-${t.number}`)
}

export async function main(argv: string[]): Promise<number> {
  const repoRoot = process.cwd()
  const mine = argv.includes('--mine')
  const explicit = argv.filter(a => !a.startsWith('--'))

  // Lazy-load CLI helpers so the pure detector stays import-light for tests.
  const { readCredentials } = await import('../cli/src/lib/config')
  const { resolveAuthedApiUrl, trimTrailingSlash } =
    await import('../cli/src/lib/api')

  const creds = readCredentials()
  if (!creds) {
    process.stderr.write('Error: not logged in. Run `lumo auth login`.\n')
    return 1
  }
  const base = trimTrailingSlash(resolveAuthedApiUrl(creds.apiUrl))

  let identifiers = explicit
  if (mine || identifiers.length === 0) {
    identifiers = [
      ...new Set([
        ...identifiers,
        ...(await fetchMyOpenTaskIdentifiers(base, creds.token)),
      ]),
    ]
  }
  if (identifiers.length === 0) {
    process.stderr.write(
      'usage: npx tsx scripts/checkpointer-drift.ts <LUM-N…> | --mine\n'
    )
    return 1
  }

  const contracts: ContractInput[] = []
  for (const id of identifiers) {
    contracts.push({
      taskIdentifier: id,
      criteria: await fetchCriteria(base, creds.token, id),
    })
  }

  const report = sweepContracts(contracts, repoRoot)
  process.stdout.write(formatReport(report))
  return report.drifted.length > 0 ? 1 : 0
}

// Run only when invoked as a script (never when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('checkpointer-drift.ts')) {
  main(process.argv.slice(2)).then(
    code => process.exit(code),
    err => {
      process.stderr.write(`checkpointer-drift: ${(err as Error).message}\n`)
      process.exit(1)
    }
  )
}
