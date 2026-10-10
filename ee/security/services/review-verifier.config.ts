/**
 * LUM-988 — the agentic verifier's switch. Import-light on purpose: stage A
 * reads it to decide whether to keep the managed scan's VM alive and to
 * start the verifier.
 */
import { isIntegrationConfigured } from '@/lib/integrations/configured'

/**
 * `LUMO_REVIEW_VERIFIER=off` is the kill switch. LUM-1025: also off when
 * Vercel Sandbox is not configured — the verifier works in a sandbox checkout.
 */
export function isReviewVerifierEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    env.LUMO_REVIEW_VERIFIER !== 'off' &&
    isIntegrationConfigured('vercelSandbox', env)
  )
}

/**
 * `LUMO_REVIEW_RANKER=off` turns off only the ranker that runs after the
 * verifier; the verifier's own verdicts still apply.
 */
export function isReviewRankerEnabled(): boolean {
  return process.env.LUMO_REVIEW_RANKER !== 'off'
}
