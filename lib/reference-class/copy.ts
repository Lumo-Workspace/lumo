import type {
  BoundaryCrossingCategory,
  VerificationRejectionReason,
} from '@prisma/client'
import type { TallyEntry } from './types'

/**
 * LUM-497 — every user-facing string of the anchor.
 *
 * The maps are typed `Record<PrismaEnum, string>` on purpose: adding an enum
 * value to the schema without adding copy here fails `tsc --noEmit`, which the
 * PR checklist already runs. That is the drift guard — no runtime enumeration
 * needed.
 */

export const REJECTION_LABELS: Record<VerificationRejectionReason, string> = {
  CRITERION_UNMET: 'criterion unmet',
  EVIDENCE_INSUFFICIENT: 'evidence insufficient',
  CHECK_EXECUTION_ERROR: 'checkpointer failed to run',
  SCOPE_MISMATCH: 'work did not match the criterion',
  OTHER: 'other',
}

export const CROSSING_LABELS: Record<BoundaryCrossingCategory, string> = {
  PUSH_TO_PROTECTED_BRANCH: 'push to a protected branch',
  MIGRATION_FILE_DELETED: 'migration file deleted',
  HARDCODED_SECRET: 'hardcoded secret',
  NEW_NPM_DEPENDENCY: 'new npm dependency',
  DESTRUCTIVE_DB_COMMAND: 'destructive DB command',
  TEST_TAMPERING: 'edited a file a checkpointer depends on',
  EXFILTRATION_PUBLIC: 'exfiltration to the public internet',
  CLOUD_DATA_DELETION: 'cloud data deletion',
  INFRA_TERMINATION: 'infrastructure termination',
  SESSION_BINDING_MISSING: 'work from an unattached session',
  CONTRACT_WEAKENING: 'acceptance criterion weakened',
  SPINOFF_LAUNDERED: 'rework spun off as new scope',
  SILENT_FIX: 'post-review fix with no send-back',
  PROJECT_RULE_VIOLATION: 'project rule violation',
  POLICY_WEAKENING: 'project policy weakened',
  STEWARD_IMPLEMENTATION_ARTIFACT: 'implementation from a steward session',
  SENSITIVE_PATH_EDIT: 'edited a sensitive path',
  HOOK_BYPASS: 'bypassed git hooks',
  TEST_FILE_DELETED: 'deleted a test file',
  SELF_DISPOSITION: 'agent-issued disposition',
  USED_TRAP_MEMORY_DELETED: 'deleted a proven-useful trap memory',
}

export const REJECTION_PROMPTS: Record<VerificationRejectionReason, string> = {
  CRITERION_UNMET:
    'Tasks here most often come back because a criterion simply was not met — which of yours is the one most likely to bounce?',
  EVIDENCE_INSUFFICIENT:
    'Tasks here most often come back for insufficient evidence — what will your key criteria point at as proof?',
  CHECK_EXECUTION_ERROR:
    'Tasks here most often come back because the checkpointer itself would not run — will yours run on a clean checkout?',
  SCOPE_MISMATCH:
    'Tasks here most often come back because the work did not match the criterion — do yours describe outcomes or steps?',
  OTHER:
    'Send-backs here did not fit the standard reasons — what could go wrong on this task that a criterion would not catch?',
}

export const CROSSING_PROMPTS: Record<BoundaryCrossingCategory, string> = {
  PUSH_TO_PROTECTED_BRANCH:
    'Tasks here have pushed to a protected branch — where will this work land?',
  MIGRATION_FILE_DELETED:
    'Tasks here have deleted migration files — does this change touch any migration files, and what happens if it does?',
  HARDCODED_SECRET:
    'Tasks here have committed secrets — does this change touch anything that reads credentials?',
  NEW_NPM_DEPENDENCY:
    'Tasks here have added npm dependencies — does this change add one, and why is it needed?',
  DESTRUCTIVE_DB_COMMAND:
    'Tasks here have run destructive DB commands — what does this change do to existing data?',
  TEST_TAMPERING:
    'Tasks here have edited files their checkpointers depend on — will the tests yours point at be rewritten by this work?',
  EXFILTRATION_PUBLIC:
    'Tasks here have sent data to the public internet — does this change move anything outward?',
  CLOUD_DATA_DELETION:
    'Tasks here have deleted cloud data — what is the blast radius if this change is wrong?',
  INFRA_TERMINATION:
    'Tasks here have terminated infrastructure — does this change touch anything running?',
  SESSION_BINDING_MISSING:
    'Tasks here recorded work from an unattached session — is this session bound to the task you are about to work on?',
  CONTRACT_WEAKENING:
    'Tasks here weakened a criterion after being failed on it — are you drafting criteria you can meet, or ones you can later soften?',
  SPINOFF_LAUNDERED:
    'Tasks here spun rework off as new scope — if this bounces, will you fix it here?',
  SILENT_FIX:
    'Tasks here were fixed after review with no send-back recorded — what would make a problem here visible instead of quiet?',
  PROJECT_RULE_VIOLATION:
    'Tasks here have broken a project rule from CLAUDE.md — which rules does this change come near?',
  POLICY_WEAKENING:
    'Tasks here weakened a project policy — does this change touch CLAUDE.md or its Forbidden list?',
  STEWARD_IMPLEMENTATION_ARTIFACT:
    'Tasks here produced implementation artifacts from a governance session — is this session meant to implement?',
  SENSITIVE_PATH_EDIT:
    'Tasks here have edited sensitive paths (auth, middleware, workflows, lockfiles, the schema) — does this change need to touch one, and who should look at that diff?',
  HOOK_BYPASS:
    'Tasks here have bypassed git hooks — if a hook fails on this change, will you fix the cause rather than skip it?',
  TEST_FILE_DELETED:
    'Tasks here have deleted test files — does this change remove a test, and what still covers what it covered?',
  SELF_DISPOSITION:
    'Tasks here have had the agent rule on its own blocker — when a crossing or finding lands, will you relay it to the user and let them run the disposition?',
  USED_TRAP_MEMORY_DELETED:
    'Tasks here have deleted a trap memory other tasks were proven to use — if a memory looks wrong, will you correct it rather than remove it?',
}

/** Display name for a signal value; unmapped values render as the raw key. */
export function labelFor(maps: Record<string, string>, key: string): string {
  return maps[key] ?? key
}

/**
 * The single reflection question, chosen in a FIXED order so the same class
 * always produces the same line: top send-back reason first, then top
 * crossing. The post-start-contract signal is a bare count with no enum value,
 * so it never supplies a question. Null when nothing maps.
 */
export function selectReflectionPrompt(
  rejections: TallyEntry[],
  crossings: TallyEntry[]
): string | null {
  const topRejection = rejections[0]
  if (topRejection) {
    return (
      REJECTION_PROMPTS[topRejection.key as VerificationRejectionReason] ?? null
    )
  }
  const topCrossing = crossings[0]
  if (topCrossing) {
    return CROSSING_PROMPTS[topCrossing.key as BoundaryCrossingCategory] ?? null
  }
  return null
}
