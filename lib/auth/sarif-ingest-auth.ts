/**
 * LUM-735: who is allowed to push a SARIF report, and for what.
 *
 * Two credentials arrive on the same `Authorization: Bearer` header:
 *
 *  - **GitHub Actions OIDC ID token** (the main path). The customer's own CI
 *    workflow requests its own OIDC ID token — no secret to provision. The
 *    token itself names the repository and the PR, so the ingest is pinned to
 *    those and workspace ownership is decided later, by the `PullRequest`
 *    row the worker looks up.
 *  - **`security:ingest` ApiKey** (fallback, for CI that isn't GitHub
 *    Actions). The key names a workspace, and that workspace is the trust
 *    boundary — the caller may push for any repository inside it.
 *
 * The two are told apart by shape: an OIDC token is a three-segment JWT, an
 * ApiKey never is. That means a malformed/expired OIDC token is a 401 rather
 * than being silently retried as an api key.
 */
import { verifyBearer } from './bearer'
import { SECURITY_INGEST_SCOPE } from '@/lib/services/auth.service'
import {
  looksLikeJwt,
  pullNumberFromRef,
  verifyGithubActionsToken,
} from './github-oidc'

export type SarifIngestPrincipal =
  | {
      kind: 'oidc'
      /** `owner/repo`, exactly as GitHub spelled it in the token. */
      repository: string
      /** PR number taken from the token's `refs/pull/<n>/merge` ref. */
      prNumber: number
      rateLimitKey: string
    }
  | {
      kind: 'key'
      workspaceId: string
      apiKeyId: string
      rateLimitKey: string
    }

function unauthorized(message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status: 401 })
}

/**
 * Resolve the bearer on a SARIF ingest request.
 *
 * Returns `null` when there is no usable credential at all (header missing or
 * malformed, unknown/revoked/out-of-scope api key) — callers map that to 401.
 * Throws `Error & { status: 401 }` when a token *claimed* to be a GitHub OIDC
 * token but failed verification or came from a run we don't accept.
 */
export async function authenticateSarifIngest(
  request: Request
): Promise<SarifIngestPrincipal | null> {
  const header = request.headers.get('Authorization')
  if (!header) return null
  if (!header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null

  if (looksLikeJwt(token)) {
    const claims = await verifyGithubActionsToken(token)
    // Only `pull_request` runs may push: the diff-aware normalizer needs a PR
    // to anchor findings to, and the PR number has to come from the token
    // (not the payload) for the identity to mean anything.
    if (claims.eventName !== 'pull_request') {
      throw unauthorized('token is not from a pull_request workflow run')
    }
    const prNumber = pullNumberFromRef(claims.ref)
    if (prNumber === null) {
      throw unauthorized('token ref is not a pull request merge ref')
    }
    return {
      kind: 'oidc',
      repository: claims.repository,
      prNumber,
      // One budget per repository regardless of how GitHub cased it, and
      // namespaced so a repo can never collide with an ApiKey id.
      rateLimitKey: `oidc:${claims.repository.toLowerCase()}`,
    }
  }

  const identity = await verifyBearer(request, {
    allowScopes: [SECURITY_INGEST_SCOPE],
  })
  if (!identity) return null
  return {
    kind: 'key',
    workspaceId: identity.workspace.id,
    apiKeyId: identity.apiKey.id,
    rateLimitKey: identity.apiKey.id,
  }
}

/**
 * For an OIDC principal, refuse a payload that points anywhere other than the
 * repository and PR the token was minted for — otherwise any repo's workflow
 * could push findings onto any other repo's PR. An api-key principal is not
 * constrained here: its boundary is the workspace, enforced by the worker.
 */
export function assertPayloadMatchesPrincipal(
  principal: SarifIngestPrincipal,
  payload: { repository: string; prNumber: number }
): void {
  if (principal.kind !== 'oidc') return
  const sameRepo =
    payload.repository.toLowerCase() === principal.repository.toLowerCase()
  if (!sameRepo || payload.prNumber !== principal.prNumber) {
    throw Object.assign(
      new Error('payload does not match the workflow identity'),
      { status: 403 }
    )
  }
}
