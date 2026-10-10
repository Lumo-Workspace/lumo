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
import { withTimeout } from '@/lib/boundary-crossing/judge-timeout'

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
 * NEW_NPM_DEPENDENCY (low severity, reversible), UNTRUSTED_CODE_EXECUTION
 * (LUM-962: its matcher drops carriers itself and never reads a quoted string
 * as a pipeline, so there is no prose candidate to confirm). A secret leak / real protected-branch push is therefore
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
    // LUM-960: `rm -rf /` is a classic quoted-in-prose example.
    'DESTRUCTIVE_FS_COMMAND',
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
  DESTRUCTIVE_FS_COMMAND:
    'destroy local data outside the repository (rm -r / find -delete on the filesystem root, a home directory or a top-level system directory, rm inside ~/Pictures|Videos|Movies|Music, shred of an absolute path, mkfs, dd of=/dev/<disk>)',
  HOOK_BYPASS:
    'bypass local git hooks (git commit / git push with --no-verify, git commit with the -n short flag, git -c core.hooksPath=<path> before commit/push, or a HUSKY=0 prefix)',
  TEST_FILE_DELETED:
    'delete a test file or test directory (rm / git rm of *.test.<code ext>, *.spec.<code ext>, *_test.go, test_*.py / *_test.py, *_spec.rb, or a __tests__/ tests/ test/ spec/ directory)',
}

// --- deterministic de-prose (Stage 1 helper) ---------------------------------
// LUM-1063: the helpers live in the core (`./prose`); re-exported for callers.
export {
  stripHeredocBodies,
  stripQuotedLiterals,
  stripProse,
} from '@/lib/boundary-crossing/prose'

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
