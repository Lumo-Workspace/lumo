/**
 * Checkpointer drift detector (LUM-436, refined by LUM-438).
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
 * Prior-resolution refinement (LUM-438). A raw zero-match cannot tell a STALE
 * checkpointer (the test existed, then was renamed/deleted) from one that is
 * simply NOT YET WRITTEN (an unstarted TODO task whose implementer hasn't
 * written the test). Running `--mine` flagged the second class as drift and
 * drowned the real signal. So a zero-match is `drifted` only when it *should*
 * resolve — the task has left TODO, or the criterion passed before (a
 * regression) — otherwise it is `pending` (informational). Only `drifted` gates
 * the exit code, so an unstarted task never fails the sweep. The signal comes
 * from the `task status` read model (LUM-344).
 *
 * Detection-only (the core invariant). This NEVER executes a checkpointer, opens
 * a network connection, POSTs a verdict, or starts/advances a verify round. The
 * pure functions below read repo files and nothing else. The only network call
 * lives in `main()`, and it is a read (`GET …/status`) used to *fetch* the
 * contracts + their resolution signal to sweep — never a write.
 *
 * Usage (a runnable script, deliberately NOT a `lumo` subcommand — it touches no
 * `cli/src/commands/**` so it carries no SKILL.md-sync obligation):
 *   npx tsx scripts/checkpointer-drift.ts LUM-433 [LUM-N…]   # explicit tasks
 *   npx tsx scripts/checkpointer-drift.ts --mine             # my open contracts
 * Exit 1 only if TRUE drift was found (pending never fails), else 0 — so it can
 * gate CI or a pre-merge hook without unstarted tasks tripping it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseJestTCheckpointer,
  type ParsedJestT,
} from '@/lib/checkpointer/parse'

// Re-exported so existing importers (the LUM-436 sweep test) keep one entry
// point; the parser itself now lives in lib/checkpointer/parse.ts (LUM-441,
// shared with the TEST_TAMPERING reward-hacking detector).
export { parseJestTCheckpointer, type ParsedJestT }

export type DriftStatus = 'drifted' | 'healthy' | 'skipped'

/**
 * The drift verdict after the LUM-438 prior-resolution refinement: a raw
 * zero-match `drifted` from the static layer is downgraded to `pending` when the
 * checkpointer is not yet *expected* to resolve (an unstarted TODO task whose
 * criterion never passed — the test simply hasn't been written). `healthy` and
 * `skipped` pass through unchanged.
 */
export type RefinedDriftStatus = DriftStatus | 'pending'

/** The slice of an acceptance criterion the detector needs. */
export interface CheckpointerCriterion {
  id?: string
  statement?: string
  verifierType?: string
  checkpointer?: string | null
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
  status: RefinedDriftStatus
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
// Prior-resolution refinement (LUM-438). The static layer above answers "is
// this checkpointer a zero-match?". It cannot answer "*should* it resolve?" —
// an unstarted TODO task whose test the implementer hasn't written yet is a
// zero-match too, but that is PENDING (expected), not stale drift. This layer
// folds in the per-criterion resolution signal to make that split. It stays
// pure: it only reclassifies the static verdict, it executes/writes nothing.
// ---------------------------------------------------------------------------

/**
 * The prior-resolution signal for one criterion, lifted off the acceptance
 * read model (`task status --json`, LUM-344): whether the task has moved past
 * TODO, and whether this criterion ever recorded a PASS.
 */
export interface CriterionResolution {
  /** task.status ≠ TODO (workStartedAt stamped) — the implementation, and so
   *  the test, should exist. A zero-match here is real drift. */
  taskLeftTodo: boolean
  /** This criterion's verdict history ever contained a PASS — it resolved at
   *  least once, so a present zero-match is a regression (the canonical case:
   *  a test renamed after it passed, leaving a stale PASS as the latest). */
  everPassed: boolean
}

/** A criterion carrying its prior-resolution signal for the refined sweep. */
export interface ResolvedCriterion extends CheckpointerCriterion {
  everPassed: boolean
}

/** One task's contract plus the task-level resolution signal. */
export interface ResolvedContractInput {
  taskIdentifier: string
  taskLeftTodo: boolean
  criteria: ResolvedCriterion[]
}

/** Refined sweep output: the `drifted` bucket split into stale vs not-yet-built. */
export interface RefinedSweepReport {
  /** Zero-match checkpointers that SHOULD resolve — actionable, gate the exit. */
  drifted: CriterionDrift[]
  /** Zero-match on an unstarted, never-passed criterion — expected, informational. */
  pending: CriterionDrift[]
  healthy: CriterionDrift[]
  skipped: CriterionDrift[]
}

/**
 * Apply the prior-resolution signal to a raw static verdict. A zero-match
 * (`drifted`) is TRUE drift only when the checkpointer is expected to resolve —
 * the task has left TODO, or the criterion passed before. Otherwise it is
 * `pending` (the test is not yet written on an unstarted task). Non-drift
 * verdicts (`healthy`/`skipped`) are returned untouched.
 */
export function refineDriftStatus(
  rawStatus: DriftStatus,
  signal: CriterionResolution
): RefinedDriftStatus {
  if (rawStatus !== 'drifted') return rawStatus
  return signal.taskLeftTodo || signal.everPassed ? 'drifted' : 'pending'
}

/**
 * Sweep contracts with their prior-resolution signal, splitting raw zero-match
 * drift into actionable `drifted` vs informational `pending`. Pure over the
 * given contracts (only `classifyCheckpointer`'s repo reads happen).
 */
export function sweepWithResolution(
  contracts: ResolvedContractInput[],
  repoRoot: string
): RefinedSweepReport {
  const report: RefinedSweepReport = {
    drifted: [],
    pending: [],
    healthy: [],
    skipped: [],
  }
  for (const contract of contracts) {
    for (const criterion of contract.criteria) {
      const r = classifyCheckpointer(criterion, repoRoot)
      const status = refineDriftStatus(r.status, {
        taskLeftTodo: contract.taskLeftTodo,
        everPassed: criterion.everPassed,
      })
      const entry: CriterionDrift = {
        taskIdentifier: contract.taskIdentifier,
        criterionId: criterion.id,
        statement: criterion.statement,
        status,
        reason: r.reason,
        testName: r.testName,
        testPaths: r.testPaths,
      }
      report[status].push(entry)
    }
  }
  return report
}

/**
 * Render a refined sweep for stdout: the actionable `drifted` bucket (gates the
 * exit code) above the informational `pending` bucket (unstarted, never-passed —
 * never fails the sweep).
 */
export function formatRefinedReport(report: RefinedSweepReport): string {
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
  if (report.pending.length > 0) {
    lines.push(
      `… ${report.pending.length} pending (not yet implemented — TODO, never verified):`
    )
    for (const p of report.pending) {
      const idPart = p.criterionId ? ` ${p.criterionId}` : ''
      lines.push(`  ${p.taskIdentifier}${idPart}: ${p.reason}`)
    }
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

/** The slice of the `task status` (LUM-344) read model the sweep consumes. */
interface TaskStatusPayload {
  task?: { status?: string }
  criteria?: CheckpointerCriterion[]
  verificationHistory?: Array<{
    verdicts?: Array<{ criterionId?: string; verdict?: string }>
  }>
}

/**
 * Fetch one task's resolved contract via the read-only acceptance-status read
 * model (`GET …/status`, LUM-344) — it returns the criteria (with
 * checkpointers), the task status, and the per-criterion verdict history in one
 * call, so the refined sweep can compute the prior-resolution signal without a
 * second read path.
 */
async function fetchResolvedContract(
  base: string,
  token: string,
  identifier: string
): Promise<ResolvedContractInput> {
  const res = await fetch(
    `${base}/api/tasks/${encodeURIComponent(identifier)}/status`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw new Error(
      `status fetch for ${identifier} failed (HTTP ${res.status})`
    )
  }
  const data = (await res.json()) as TaskStatusPayload

  // everPassed = the criterion recorded a PASS in ANY round (not just latest —
  // a test renamed after passing leaves a stale PASS, which is exactly the drift
  // this is meant to surface). PASS_WITH_FOLLOWUP counts as a pass.
  const passedCriterionIds = new Set<string>()
  for (const round of data.verificationHistory ?? []) {
    for (const v of round.verdicts ?? []) {
      if (
        v.criterionId &&
        (v.verdict === 'PASS' || v.verdict === 'PASS_WITH_FOLLOWUP')
      ) {
        passedCriterionIds.add(v.criterionId)
      }
    }
  }

  const taskLeftTodo = (data.task?.status ?? 'TODO').toUpperCase() !== 'TODO'

  return {
    taskIdentifier: identifier,
    taskLeftTodo,
    criteria: (data.criteria ?? []).map(c => ({
      ...c,
      everPassed: c.id != null && passedCriterionIds.has(c.id),
    })),
  }
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

  const contracts: ResolvedContractInput[] = []
  for (const id of identifiers) {
    contracts.push(await fetchResolvedContract(base, creds.token, id))
  }

  // Refined sweep: a zero-match on an unstarted, never-passed criterion is the
  // test not yet written (PENDING) — only true stale drift gates the exit code,
  // so an unstarted task never fails the sweep.
  const report = sweepWithResolution(contracts, repoRoot)
  process.stdout.write(formatRefinedReport(report))
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
