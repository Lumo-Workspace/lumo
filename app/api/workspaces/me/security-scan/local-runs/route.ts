import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { localScanUploadSchema } from '@/ee/security/validation/local-scan-log'
import {
  checkLocalScanLogRateLimit,
  localScanLogService,
  LOCAL_SCAN_LOG_OFF,
} from '@/ee/security/services/local-scan-log.service'

export const runtime = 'nodejs'

/** A request body larger than this is refused before parsing. */
const MAX_BODY_BYTES = 1024 * 1024

/**
 * POST /api/workspaces/me/security-scan/local-runs — LUM-1259: record the
 * local scan results `lumo security scan --log` reports, one run per commit
 * (`{ version: 1, runs: [...] }`, up to 50). Any member, with the normal CLI
 * key; the workspace comes from the identity and must have opted in (403
 * `{ code: 'LOCAL_SCAN_LOG_OFF' }` otherwise); a repository of another
 * workspace is a 404. Identical reruns are answered as duplicates. 30
 * req/min per member. Results are LOCAL: they never block or clear DONE.
 */
export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  // Content-Length is a hint (a chunked body has none): the bytes read decide.
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  const raw = await request.text().catch(() => '')
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES)
    return NextResponse.json({ error: 'Body too large' }, { status: 413 })
  let body: unknown = null
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  const parsed = localScanUploadSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)
  try {
    await checkLocalScanLogRateLimit(
      `${identity.workspaceId}:${identity.memberId}`
    )
    const result = await localScanLogService.record(
      { workspaceId: identity.workspaceId, memberId: identity.memberId },
      parsed.data
    )
    return NextResponse.json(result)
  } catch (error) {
    if ((error as { code?: unknown })?.code === LOCAL_SCAN_LOG_OFF)
      return NextResponse.json(
        { error: (error as Error).message, code: LOCAL_SCAN_LOG_OFF },
        { status: 403 }
      )
    return serviceErrorResponse(
      error,
      '[POST /api/workspaces/me/security-scan/local-runs]'
    )
  }
}
