export * from './types'
export { addedLinesWithNumbers } from './diff-lines'
export {
  scanSecrets,
  redactKnownSecrets,
  redactForInjection,
  redactForStorage,
  MAX_SCANNED_LINE_CHARS,
  type InjectionRedaction,
  type StorageRedaction,
  type InjectionRedactionOptions,
} from './scan-secrets'
// LUM-784 — redact + guard at every injection boundary
export {
  guardInjectedText,
  redactPromptLine,
  redactSlackSnapshotForInjection,
  renderInlineRedactionMarker,
  renderRedactionNotices,
  type GuardedInjectedText,
} from './inject-guard'
export {
  redactSecret,
  redactLine,
  maskQuotedValues,
  secretFingerprint,
  vulnerabilityFingerprint,
  sarifFingerprint,
  dependencyFingerprint,
  shannonEntropy,
} from './redact'
export {
  SECRET_PATTERNS,
  isDowngradedPath,
  isPlaceholderValue,
} from './secret-patterns'
export {
  truncateSecurityDiff,
  packSecurityDiff,
  judgeDiffTier,
  JUDGE_DIFF_BUDGET_TIERS,
  JUDGE_TIMEOUT_CEILING_MS,
  SECURITY_DIFF_MAX_CHARS,
} from './truncate'
export type { SecurityDiffBudget } from './truncate'
export { parseJudgeBudget } from './judge-budget'
export type { JudgeBudget } from './judge-budget'
export {
  stagesOf,
  EXTERNAL_ERROR_PREFIX,
  type StagesOfScanInput,
} from './stages'
export {
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  changedLinesOfDiff,
  sarifSeverity,
  sarifKind,
  toolSlug,
  isSupplyChainTool,
  parseDependencyMessage,
  ecosystemOfLockfile,
  trivyFileLevelKeys,
  MAX_SARIF_FINDINGS,
  type NormalizeResult,
} from './sarif'
// LUM-739 — L3 hunt (pure halves)
export { inheritDispositions } from './inherit-dispositions'
export {
  HUNT_CATEGORIES,
  CATEGORY_CWE_HINT,
  HuntCandidateSchema,
  huntFingerprint,
  type HuntCategory,
  type HuntCandidate,
} from './hunt/candidate'
export {
  mechanicalVerify,
  type RejectedCandidate,
  type VerifiedCandidate,
  type MechanicalVerifyResult,
} from './hunt/mechanical-verify'
export {
  evaluateHuntTrigger,
  addedControlCallIds,
  L4_CROSSING_CATEGORIES,
  type HuntTriggerInput,
  type HuntTriggerResult,
} from './hunt/trigger'
// LUM-740 — the workspace policy table
export {
  DEFAULT_SECURITY_POLICY,
  securityPolicySchema,
  parseSecurityPolicy,
  isBlockingUnderPolicy,
  type SecurityPolicy,
  type SecurityPolicyRule,
} from './policy'
export { extractDiffHunk, DIFF_HUNK_RADIUS } from './diff-snippet'
export { suggestionOutcomeFor } from './suggestion'
