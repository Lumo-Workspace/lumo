/**
 * LUM-466 — promote the LUM-463 two-stage pipeline to the ACTION categories.
 *
 * The deterministic command matchers (PUSH_TO_PROTECTED_BRANCH,
 * MIGRATION_FILE_DELETED, DESTRUCTIVE_DB_COMMAND, EXFILTRATION_PUBLIC,
 * CLOUD_DATA_DELETION, INFRA_TERMINATION) are high-recall: a forbidden token
 * that appears only as PROSE — inside a commit message (`-m` / `-F` / heredoc),
 * a PR body (`gh pr create --body`), an `echo` string, or any other quoted
 * literal — still trips them (`git commit -m "…git push origin main…"`). Pure
 * regex de-prose is a whack-a-mole that never ends, so this module adds the
 * LUM-463 confirmation step to the action categories:
 *
 *   Stage 1 (deterministic, in the service): re-run the matcher on a
 *     prose-stripped copy of the command. A category that STILL matches outside
 *     all quotes/heredocs is a real executed action → certain → flag, NO LLM
 *     call (cost-bounding + the "deterministically-certain HIGH hit is flagged
 *     regardless of the LLM" red line).
 *   Stage 2 (this module's `confirmActionCrossing`): a category that matched
 *     ONLY inside prose is an ambiguous CANDIDATE → ask the LLM whether the
 *     command actually EXECUTES the action or the token is mere literal text.
 *     PROSE_ONLY → suppress; REAL_ACTION / uncertain / failure → keep flagged.
 *
 * Red lines (sail with LUM-463): conservative — any judge throw/timeout falls
 * back to REAL_ACTION (recall never lost); observe-only / best-effort — a
 * failure never blocks ingestion (shared `withTimeout`, exit-0 invariant); the
 * judge only ever SUPPRESSES a prose candidate, never clears a real action and
 * never sets a human disposition (LUM-435/422 stay the final arbiter).
 */
import type { BoundaryCrossingCategory } from '@prisma/client'
import { withTimeout } from './judge-timeout'

/** REAL_ACTION = the command executes the forbidden action; PROSE_ONLY = the
 *  matched token is only literal text (commit message / PR body / echo / etc). */
export type ActionConfirmVerdict = 'REAL_ACTION' | 'PROSE_ONLY'

/** What the confirmation judge sees: the raw command and which action class the
 *  deterministic matcher flagged (so the prompt asks about the right action). */
export interface ActionConfirmInput {
  command: string
  category: BoundaryCrossingCategory
}

/** Abstraction over the LLM call (DIP) — injected so tests never hit the model. */
export type ActionConfirmJudge = (
  input: ActionConfirmInput
) => Promise<ActionConfirmVerdict>

export interface ConfirmDeps {
  judge: ActionConfirmJudge
  /** Best-effort timeout; on expiry the verdict is REAL_ACTION (keep flagged). */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * The action categories the confirmation step covers — exactly the command-
 * shaped forbidden classes whose regex can match prose. NOT included:
 * HARDCODED_SECRET (content scan, never a "command in prose"),
 * NEW_NPM_DEPENDENCY (low severity, reversible), TEST_TAMPERING (handled by its
 * own LUM-463 pipeline). A secret leak / real protected-branch push is therefore
 * never routed through — and never suppressible by — this LLM step.
 */
export const ACTION_CONFIRM_CATEGORIES: ReadonlySet<BoundaryCrossingCategory> =
  new Set<BoundaryCrossingCategory>([
    'PUSH_TO_PROTECTED_BRANCH',
    'MIGRATION_FILE_DELETED',
    'DESTRUCTIVE_DB_COMMAND',
    'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION',
    'INFRA_TERMINATION',
    // LUM-736 L4 Session Guard: both are command-shaped and can be quoted in a
    // commit message / PR body, so they take the same prose-confirmation path.
    'HOOK_BYPASS',
    'TEST_FILE_DELETED',
  ])

export function isActionConfirmCategory(
  category: BoundaryCrossingCategory
): boolean {
  return ACTION_CONFIRM_CATEGORIES.has(category)
}

/** Per-category description of the forbidden ACTION, for the judge prompt. */
export const ACTION_DESCRIPTIONS: Record<string, string> = {
  PUSH_TO_PROTECTED_BRANCH:
    'push commits to a protected branch (main / master / develop)',
  MIGRATION_FILE_DELETED: 'delete a file under prisma/migrations/',
  DESTRUCTIVE_DB_COMMAND:
    'run a destructive / irreversible database command (drop or truncate a table/database, prisma migrate reset, db push --force-reset/--accept-data-loss)',
  EXFILTRATION_PUBLIC:
    'exfiltrate local data to a public endpoint, or make a repository public',
  CLOUD_DATA_DELETION:
    'delete cloud-storage data (aws s3 rm/rb, gsutil rm, gcloud storage rm, vercel blob del)',
  INFRA_TERMINATION:
    'terminate or restart infrastructure (kill -9/pkill/killall, systemctl/service restart|stop, docker kill/stop, docker-compose down, kubectl delete/rollout/drain, pm2 stop/kill)',
  HOOK_BYPASS:
    'bypass local git hooks (git commit / git push with --no-verify, or a HUSKY=0 prefix)',
  TEST_FILE_DELETED:
    'delete a test file or test directory (rm / git rm of *.test.*, *.spec.*, or __tests__/)',
}

// --- deterministic de-prose (Stage 1 helper) ---------------------------------

/**
 * Drop heredoc BODIES (keep the `<<EOF` intro line) so a forbidden token written
 * into a heredoc-fed commit message (`git commit -F - <<EOF … EOF`) is removed.
 * Line-based and best-effort: handles `<<EOF`, `<<-EOF`, and quoted delimiters.
 */
function stripHeredocBodies(cmd: string): string {
  const lines = cmd.split('\n')
  const out: string[] = []
  let delimiter: string | null = null
  for (const line of lines) {
    if (delimiter !== null) {
      // Inside a heredoc body — drop lines until the closing delimiter line.
      if (line.trim() === delimiter) delimiter = null
      continue
    }
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_]\w*)\1/)
    if (m) {
      delimiter = m[2] as string
      out.push(line) // keep the intro itself; only the body is prose
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

/**
 * Empty the CONTENTS of single- and double-quoted string literals (keep the
 * delimiters), so a forbidden token that lived only inside a quoted argument
 * (a `-m`/`--body`/`echo` string) is removed while the command structure around
 * it survives. Backtick / `$(…)` command substitutions are LEFT INTACT —
 * their contents are actually executed, so a real `` `git push origin main` ``
 * must stay matchable (recall over precision; the LLM is the backstop, not this).
 */
function stripQuotedLiterals(cmd: string): string {
  let out = ''
  let i = 0
  while (i < cmd.length) {
    const c = cmd[i]
    if (c === '\\' && i + 1 < cmd.length) {
      // Escaped char outside quotes — copy both verbatim.
      out += c + cmd[i + 1]
      i += 2
      continue
    }
    if (c === "'") {
      // Single quotes: no escapes inside. Drop everything to the next `'`.
      out += "'"
      i++
      while (i < cmd.length && cmd[i] !== "'") i++
      if (i < cmd.length) {
        out += "'"
        i++
      }
      continue
    }
    if (c === '"') {
      // Double quotes: drop to the next unescaped `"` (respecting `\"`). Inner
      // backtick/$() substitutions are dropped too — a real action hidden inside
      // a double-quoted substitution is exotic, and dropping it only routes it to
      // the LLM (which keeps it on uncertainty), never silently clears it.
      out += '"'
      i++
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === '\\' && i + 1 < cmd.length) {
          i += 2
          continue
        }
        i++
      }
      if (i < cmd.length) {
        out += '"'
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Prose-strip a command: drop heredoc bodies, then empty quoted-literal
 * contents. Pure. The service re-runs the deterministic matchers on the result
 * — a forbidden category that survives is a real action (certain); one that
 * vanishes matched only prose and is sent to the LLM to confirm.
 */
export function stripProse(cmd: string): string {
  return stripQuotedLiterals(stripHeredocBodies(cmd))
}

// --- Stage 2 orchestrator -----------------------------------------------------

/**
 * Best-effort LLM confirmation for a prose-candidate action crossing. Returns
 * the judge's verdict, or REAL_ACTION on ANY failure/timeout — the conservative
 * direction that keeps a possible real action flagged (recall preserved). Never
 * throws: a hung or erroring judge can never block hook ingestion (the shared
 * `withTimeout`, exit-0 invariant).
 */
export async function confirmActionCrossing(
  input: ActionConfirmInput,
  deps: ConfirmDeps
): Promise<ActionConfirmVerdict> {
  try {
    return await withTimeout(
      deps.judge(input),
      deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
  } catch {
    return 'REAL_ACTION'
  }
}
