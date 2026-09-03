export * from './types'
export { addedLinesWithNumbers } from './diff-lines'
export { scanSecrets } from './scan-secrets'
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
