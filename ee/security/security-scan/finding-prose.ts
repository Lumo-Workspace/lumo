/**
 * PURE — LUM-1200 follow-up: how model-written finding prose is redacted
 * before it is stored (and so before the panel, the CLI and the inline
 * comment show it).
 */
import {
  redactFindingText,
  redactSummaryText,
} from '@/lib/security-scan/scan-secrets'

/**
 * LUM-1200 follow-up — the redaction for a finding's prose (the AI review's
 * and the hunt's title and detail, the verifier's reason): text about the
 * code, which quotes the code inline. `redactFindingText`
 * masked every quoted span of any text mentioning a token, so production
 * (probe PR 60) rendered "The condition `expiresAt > now || token.length >
 * 0`" as "The condition `expi…(len 35)`" in the finding detail and its
 * inline comment. `redactSummaryText` keeps such code readable and still
 * masks registry secrets, credential-shaped values and a value right after
 * a credential key. A hardcoded-credential finding is ABOUT a secret value,
 * so its prose keeps the stricter pass.
 */
export function redactFindingProse(text: string, isCredential = false): string {
  return isCredential ? redactFindingText(text) : redactSummaryText(text)
}
