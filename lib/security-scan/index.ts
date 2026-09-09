export * from './types'
export { addedLinesWithNumbers } from './diff-lines'
export {
  scanSecrets,
  redactKnownSecrets,
  MAX_SCANNED_LINE_CHARS,
} from './scan-secrets'
export {
  redactSecret,
  redactLine,
  maskQuotedValues,
  secretFingerprint,
  vulnerabilityFingerprint,
  sarifFingerprint,
  shannonEntropy,
} from './redact'
export {
  SECRET_PATTERNS,
  isDowngradedPath,
  isPlaceholderValue,
} from './secret-patterns'
export { truncateSecurityDiff, SECURITY_DIFF_MAX_CHARS } from './truncate'
export {
  parseSarif,
  normalizeSarif,
  changedLinesOf,
  sarifSeverity,
  sarifKind,
  toolSlug,
  MAX_SARIF_FINDINGS,
  type NormalizeResult,
} from './sarif'
