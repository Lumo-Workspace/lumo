/**
 * Context drift detector (LUM-405, v1).
 *
 * Mechanizes the CLAUDE.md human rule "修改 cli/src/commands/ 下的命令必须同步
 * 更新 cli/skill/SKILL.md(及 references/)": when a changeset touches
 * a `trigger` path but none of its declared `companion` docs, the agent docs are
 * likely stale relative to the code, so we warn.
 *
 * Source: Codified Context (arXiv 2602.20478) — the report's first failure mode
 * is stale spec (implementation moved, docs didn't), and its mitigation is a
 * session-start drift detector over git diff × a subsystem→doc map. This is the
 * deterministic, cheapest landing of that idea for Lumo.
 *
 * Red lines (LUM-405):
 *   1. NON-BLOCKING — staleness detection has false positives by design (a pure
 *      internal refactor is exempt per CLAUDE.md), so the check only warns and
 *      always exits 0. It never fails a commit.
 *   2. SINGLE IN-REPO SOURCE — the rule table (`DRIFT_RULES`) lives here, once.
 *   3. RESPECTS THE EXEMPTIONS — it never guesses intent; the committer asserts
 *      an exempt change with the `[skip-drift]` marker in the commit message,
 *      which leaves an audit trail in git history.
 *
 * Wiring: the husky `commit-msg` hook runs `npx tsx scripts/drift-check.ts "$1"`.
 * commit-msg is the only git stage where BOTH the staged changeset
 * (`git diff --cached`) and the commit message (the skip-marker source) are
 * available — pre-commit/lint-staged runs before the message exists.
 *
 * Scope is v1 = rule ① only (cli/src/commands → lumo skill docs). Rule ②
 * (docs/live-docs ↔ the live document) is deferred: its right-hand side is a
 * server-side document, not a repo file, so it cannot be judged in a local,
 * offline git gate.
 */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'

/** Commit-message marker that suppresses the check for one commit. */
export const SKIP_MARKER = '[skip-drift]'

export type DriftRule = {
  /** Stable id, used in machine output. */
  id: string
  /** Human label for the trigger surface (for the warning text). */
  triggerLabel: string
  /** Human label for the companion surface (for the warning text). */
  companionLabel: string
  /** True if a changed path is part of the watched (trigger) surface. */
  matchTrigger: (path: string) => boolean
  /** True if a changed path satisfies the companion sync. */
  matchCompanion: (path: string) => boolean
}

/**
 * The drift rule table — the single in-repo source. v1 carries exactly one rule.
 * A rule fires when at least one trigger path changed but NO companion path did.
 */
export const DRIFT_RULES: ReadonlyArray<DriftRule> = [
  {
    id: 'cli-skill-sync',
    triggerLabel: 'cli/src/commands/**',
    companionLabel: 'cli/skill/SKILL.md (or cli/skill/references/**)',
    matchTrigger: p => p.startsWith('cli/src/commands/'),
    matchCompanion: p =>
      p === 'cli/skill/SKILL.md' || p.startsWith('cli/skill/references/'),
  },
]

export type DriftWarning = {
  ruleId: string
  message: string
}

/**
 * Pure core: given the changed files and the commit message, return one warning
 * per fired rule. A `[skip-drift]` marker in the message suppresses everything.
 */
export function detectDrift(
  changedFiles: string[],
  commitMessage: string,
  rules: ReadonlyArray<DriftRule> = DRIFT_RULES
): DriftWarning[] {
  if (commitMessage.includes(SKIP_MARKER)) return []

  const warnings: DriftWarning[] = []
  for (const rule of rules) {
    const triggered = changedFiles.some(rule.matchTrigger)
    if (!triggered) continue
    const companionSynced = changedFiles.some(rule.matchCompanion)
    if (companionSynced) continue
    warnings.push({
      ruleId: rule.id,
      message:
        `${rule.triggerLabel} changed but ${rule.companionLabel} did not — ` +
        `the agent docs may be stale relative to the code. Update the companion ` +
        `to match, or add ${SKIP_MARKER} to the commit message if this is a ` +
        `pure internal refactor / copy tweak / non-interface fix (CLAUDE.md exemption).`,
    })
  }
  return warnings
}

/** Read the staged changeset; never throws (a git failure → no warnings). */
export function readStagedFiles(): string[] {
  try {
    const out = execFileSync('git', ['diff', '--cached', '--name-only'], {
      encoding: 'utf8',
    })
    return out
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

/** Read the commit message from the path the commit-msg hook passes as `$1`. */
export function readCommitMessage(path: string | undefined): string {
  if (!path) return ''
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function formatWarnings(warnings: DriftWarning[]): string {
  const lines = ['⚠ context-drift (non-blocking):']
  for (const w of warnings) lines.push(`  [${w.ruleId}] ${w.message}`)
  return lines.join('\n') + '\n'
}

/**
 * Runnable wrapper. Returns the process exit code — ALWAYS 0 (warning-only).
 * Inputs are injectable for tests; in production they default to the staged
 * changeset and the message file path.
 */
export function run(
  opts: {
    changedFiles?: string[]
    commitMessage?: string
    messagePath?: string
    write?: (s: string) => void
  } = {}
): number {
  const changedFiles = opts.changedFiles ?? readStagedFiles()
  const commitMessage =
    opts.commitMessage ?? readCommitMessage(opts.messagePath)
  const write = opts.write ?? ((s: string) => process.stderr.write(s))

  const warnings = detectDrift(changedFiles, commitMessage)
  if (warnings.length > 0) write(formatWarnings(warnings))
  return 0
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('drift-check.ts')) {
  process.exit(run({ messagePath: process.argv[2] }))
}
