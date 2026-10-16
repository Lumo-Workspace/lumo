/**
 * The production removal policy in the replay's terms. A replay records the
 * review's own kind (`logic_error`, `xss`, …); production stores a bug kind
 * as CORRECTNESS (`review:<kind>`) and a security kind as a vulnerability
 * (`vuln:<kind>`), and `verifierAppliesTo` reads the stored kind. PURE.
 */
import {
  isBugKind,
  type ReviewKind,
} from '@/ee/security/security-scan/review-kinds'
import { verifierAppliesTo } from '@/ee/security/security-scan/verifier'

/** May the verifier (and so the ranker) reject this replay finding? */
export function replayVerifierAppliesTo(f: {
  kind: string
  severity: string
  pathInstruction?: string | null
}): boolean {
  return verifierAppliesTo({
    kind: isBugKind(f.kind as ReviewKind) ? 'CORRECTNESS' : 'VULNERABILITY',
    severity: f.severity,
    pathInstruction: f.pathInstruction ?? null,
  })
}
