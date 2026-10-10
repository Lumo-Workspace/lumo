/**
 * LUM-1063 — the crossing taxonomy (severity tier + reversibility per
 * category), single-sourced for the core pipeline, the detectors a plugin
 * registers and every reader of stored crossings. Pure; moved verbatim out of
 * `lib/services/boundary-detector.service.ts`, which re-exports both.
 */
import type {
  BoundaryCrossingCategory,
  BoundaryCrossingSeverity,
} from '@prisma/client'

/**
 * Taxonomy-driven reversibility (LUM-435; reclassified LUM-516). Anchored on the
 * world/external-state boundary: a crossing is REVERSIBLE when it mutates only
 * repo or Lumo-internal state (restorable from git or Lumo state), and
 * IRREVERSIBLE only when it destroys external world state that neither git nor
 * Lumo can bring back — a leaked secret, dropped/exfiltrated/deleted data, or
 * terminated infra. Editorial crossings (migration-file deletes, unbound-session
 * work, protected-branch pushes) are reversible: `git restore` / archive-and-reopen /
 * a follow-up commit undoes the artifact.
 *
 * Reversibility is ORTHOGONAL to severity. The DONE gate blocks on severity
 * (HIGH), never on reversibility — so this classification weakens no gate; it
 * only sets the lock/unlock label and the loudness of the remediation nudge. Do
 * NOT "simplify" the editorial classes back to irreversible.
 *
 * Enumerate the reversible set; any unknown/future category falls through to
 * irreversible — the conservative default until it is deliberately classified.
 */
const REVERSIBLE_CATEGORIES: ReadonlySet<BoundaryCrossingCategory> = new Set([
  'NEW_NPM_DEPENDENCY',
  // LUM-942: deprecated — the acceptance-criteria detectors that produced these
  // were removed and nothing writes them anymore; kept so old rows still render
  // with their original (editorial, reversible) classification.
  'TEST_TAMPERING',
  'CONTRACT_WEAKENING',
  'SPINOFF_LAUNDERED',
  'SILENT_FIX',
  'MIGRATION_FILE_DELETED',
  'SESSION_BINDING_MISSING',
  'PUSH_TO_PROTECTED_BRANCH',
  // LUM-630: a committed CLAUDE.md edit that removed/downgraded a rule is repo
  // state — `git restore` brings the rule back.
  'POLICY_WEAKENING',
  // LUM-640: a steward-session commit is repo state (revertable) and a PR can
  // be closed — same world-state class as PUSH_TO_PROTECTED_BRANCH.
  'STEWARD_IMPLEMENTATION_ARTIFACT',
  // LUM-736: the L4 session-guard classes mutate repo state only (an edit, a
  // deleted tracked file) or skip a local hook — `git restore` / a follow-up
  // commit / re-running the hooks undoes each of them.
  'SENSITIVE_PATH_EDIT',
  'HOOK_BYPASS',
  'TEST_FILE_DELETED',
  // LUM-963: a read mutates nothing — no repo, Lumo or world state changes.
  // (Sending what was read somewhere is a separate, irreversible class.)
  'SENSITIVE_PATH_READ',
])

/** Target prefix stamped by the code pipeline on diff-based rule violations. */
const CODE_RULE_TARGET_PREFIX = 'coderule:'

export function isReversible(
  category: BoundaryCrossingCategory,
  target?: string | null
): boolean {
  // LUM-630: PROJECT_RULE_VIOLATION spans two origins with different
  // world-state footprints, so it is classified by target, not as a whole:
  // - `coderule:*` (code pipeline) — the violation is diff content, pure repo
  //   state, undone by a follow-up commit → reversible.
  // - `actionrule:*` (command matcher) — the matched command is arbitrary
  //   shell and may have touched external state → conservative irreversible,
  //   same default as an unknown category.
  if (category === 'PROJECT_RULE_VIOLATION') {
    return target?.startsWith(CODE_RULE_TARGET_PREFIX) === true
  }
  return REVERSIBLE_CATEGORIES.has(category)
}

/**
 * Taxonomy-driven severity tier (LUM-442), single source alongside the matchers.
 * HIGH = the "rare but high-severity" classes (secret leak, destructive DB,
 * exfiltration, cloud-data deletion, infra termination, untrusted code
 * execution). MEDIUM = shared-branch
 * push / migration deletion (serious but recoverable). LOW = a dependency
 * install. Evasion-decoded matches are escalated to HIGH at detection time
 * regardless of the underlying class.
 */
export function severityFor(
  category: BoundaryCrossingCategory
): BoundaryCrossingSeverity {
  switch (category) {
    case 'NEW_NPM_DEPENDENCY':
    // LUM-963: a hint for the reviewer, always advisory — never blocks DONE.
    case 'SENSITIVE_PATH_READ':
      return 'LOW'
    case 'PUSH_TO_PROTECTED_BRANCH':
    case 'MIGRATION_FILE_DELETED':
    // LUM-942: deprecated (no longer produced — the acceptance-criteria
    // detectors were removed); old rows keep their original MEDIUM tier.
    case 'TEST_TAMPERING':
    case 'CONTRACT_WEAKENING':
    case 'SPINOFF_LAUNDERED':
    case 'SILENT_FIX':
    // LUM-491: unbound-session work is serious (session-binding lock bypass) but
    // deterministically detectable and not data-destructive, so MEDIUM.
    case 'SESSION_BINDING_MISSING':
    // LUM-640: implementation artifacts from a STEWARD (governance) session —
    // a role-boundary breach, deterministically detectable and repo-scoped
    // (like SESSION_BINDING_MISSING), so MEDIUM.
    case 'STEWARD_IMPLEMENTATION_ARTIFACT':
    // LUM-736 L4 Session Guard: deterministic, repo-scoped, not data-destructive
    // — visible + tiered, honours the workspace opt-out rather than force-gating.
    case 'SENSITIVE_PATH_EDIT':
    case 'HOOK_BYPASS':
    case 'TEST_FILE_DELETED':
    // LUM-793: deleting a proven-useful TRAP memory destroys team knowledge but
    // is not data-destructive to a customer's world — MEDIUM, in the same
    // visible-and-dismissable tier as TEST_FILE_DELETED (its nearest analogue:
    // "something that was protecting us stopped existing").
    case 'USED_TRAP_MEMORY_DELETED':
      return 'MEDIUM'
    case 'HARDCODED_SECRET':
    case 'DESTRUCTIVE_DB_COMMAND':
    case 'EXFILTRATION_PUBLIC':
    case 'CLOUD_DATA_DELETION':
    case 'INFRA_TERMINATION':
    // LUM-960: wiping a root-level directory / disk outside the repo.
    case 'DESTRUCTIVE_FS_COMMAND':
    // LUM-962: running code from an unvetted source — whatever it does is
    // already done; the same "rare but high-severity" tier as exfiltration.
    case 'UNTRUSTED_CODE_EXECUTION':
    // LUM-750 (reverted): the enum value stays (Postgres cannot drop one); it
    // is never produced, but it stays classified HIGH + irreversible so the
    // taxonomy table covers every enum value.
    case 'SELF_DISPOSITION':
      return 'HIGH'
    default:
      return 'MEDIUM'
  }
}
