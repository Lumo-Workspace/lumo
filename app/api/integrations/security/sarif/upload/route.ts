import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { logger } from '@/lib/logger'
import {
  authenticateSarifIngest,
  assertPayloadMatchesPrincipal,
} from '@/lib/auth/sarif-ingest-auth'
import { checkSarifIngestRateLimit } from '@/lib/services/security-sarif-rate-limit'
import { startSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-start'
import { SARIF_MAX_GZ_BYTES } from '@/lib/services/security-sarif-ingest.service'
import {
  sarifClientPayloadSchema,
  sarifTokenPayloadSchema,
  expectedSarifPathname,
  pathnameMatches,
} from '@/lib/validation/security-sarif'

export const runtime = 'nodejs'

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

/**
 * POST /api/integrations/security/sarif/upload — LUM-735 token issuance +
 * completion webhook for `@vercel/blob/client`'s `handleUpload`. Whatever the
 * bearer proved goes into `tokenPayload` server-side, so `onUploadCompleted`
 * starts the ingest run trusting nothing the client sent directly: a
 * `security:ingest` ApiKey contributes its `workspaceId`, a GitHub Actions
 * OIDC token instead pins `repository`/`prNumber` to its own claims and
 * leaves ownership to the PullRequest row the workflow looks up.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => {
      throw Object.assign(new Error('Invalid JSON body'), { status: 400 })
    })) as HandleUploadBody
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const principal = await authenticateSarifIngest(request)
        if (!principal) {
          throw Object.assign(new Error('Unauthorized'), { status: 401 })
        }
        await checkSarifIngestRateLimit(principal.rateLimitKey)

        const parsed = sarifClientPayloadSchema.safeParse(
          safeJsonParse(clientPayload ?? '')
        )
        if (!parsed.success) {
          throw Object.assign(new Error('Invalid clientPayload'), {
            status: 400,
          })
        }
        assertPayloadMatchesPrincipal(principal, parsed.data)
        if (!pathnameMatches(pathname, expectedSarifPathname(parsed.data))) {
          throw Object.assign(
            new Error('pathname does not match clientPayload'),
            { status: 400 }
          )
        }

        return {
          allowedContentTypes: ['application/gzip'],
          maximumSizeInBytes: SARIF_MAX_GZ_BYTES,
          addRandomSuffix: true,
          // `headSha` stays payload-supplied even on the OIDC path: a
          // `pull_request` token's `sha` claim is the merge commit GitHub
          // synthesised, not the PR head the report was produced against.
          tokenPayload: JSON.stringify({
            auth: principal.kind,
            ...(principal.kind === 'key'
              ? { workspaceId: principal.workspaceId }
              : {}),
            ...parsed.data,
            // On the OIDC path the token's `repository` claim is the canonical
            // spelling — GitHub's own casing — so it, not the client payload's,
            // is what the started job carries. (The pathname check above
            // deliberately stays on the payload: the client built that path
            // from `github.repository`, in the same casing it sent here.)
            ...(principal.kind === 'oidc'
              ? { repository: principal.repository }
              : {}),
          }),
        }
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const parsed = sarifTokenPayloadSchema.safeParse(
          tokenPayload ? safeJsonParse(tokenPayload) : null
        )
        if (!parsed.success) {
          logger.warn('[security-sarif upload] missing/invalid tokenPayload')
          return
        }
        // `auth` may be absent on a token minted by the previous deployment
        // (see sarifTokenPayloadSchema); the payload's shape says which path
        // minted it, since `workspaceId` exists on the ApiKey path only.
        const auth =
          parsed.data.auth ??
          (parsed.data.workspaceId !== undefined ? 'key' : 'oidc')
        // LUM-735 v4: start() only enqueues the durable run, so awaiting it
        // here is cheap and makes the blob store's callback carry the
        // outcome. A failed start is logged by the helper; there is nothing
        // else this callback could do about it.
        await startSecuritySarifIngest({
          url: blob.url,
          pathname: blob.pathname,
          ...(auth === 'key' && parsed.data.workspaceId !== undefined
            ? { workspaceId: parsed.data.workspaceId }
            : {}),
          repository: parsed.data.repository,
          headSha: parsed.data.headSha,
          prNumber: parsed.data.prNumber,
          tool: parsed.data.tool,
        })
      },
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status
    if (status === 400 || status === 401 || status === 403 || status === 429) {
      const message = error instanceof Error ? error.message : 'Bad Request'
      return NextResponse.json({ error: message }, { status })
    }
    logger.error(
      '[security-sarif upload] failed:',
      error instanceof Error ? error.message : error
    )
    return NextResponse.json({ error: 'upload failed' }, { status: 500 })
  }
}
