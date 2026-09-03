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
  shannonEntropy,
} from './redact'
export {
  SECRET_PATTERNS,
  isDowngradedPath,
  isPlaceholderValue,
} from './secret-patterns'
