import { NextRequest, NextResponse } from 'next/server'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import { logger } from '@/lib/logger'
import { verifyBearer } from '@/lib/auth/bearer'
import { SECURITY_INGEST_SCOPE } from '@/lib/services/auth.service'
import { checkSarifIngestRateLimit } from '@/lib/services/security-sarif-rate-limit'
import { dispatchSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-dispatch'
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
 * completion webhook for `@vercel/blob/client`'s `handleUpload`. The minted
 * token carries `workspaceId` from the verified bearer key (never the client
 * payload) inside `tokenPayload`, so `onUploadCompleted` dispatches trusting
 * nothing the client sent directly.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json()) as HandleUploadBody
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const identity = await verifyBearer(request, {
          allowScopes: [SECURITY_INGEST_SCOPE],
        })
        if (!identity) {
          throw Object.assign(new Error('Unauthorized'), { status: 401 })
        }
        await checkSarifIngestRateLimit(identity.apiKey.id)

        const parsed = sarifClientPayloadSchema.safeParse(
          safeJsonParse(clientPayload ?? '')
        )
        if (!parsed.success) {
          throw Object.assign(new Error('Invalid clientPayload'), {
            status: 400,
          })
        }
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
          tokenPayload: JSON.stringify({
            workspaceId: identity.workspace.id,
            ...parsed.data,
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
        await dispatchSecuritySarifIngest({
          url: blob.url,
          pathname: blob.pathname,
          workspaceId: parsed.data.workspaceId,
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
    if (status === 400 || status === 401 || status === 429) {
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
