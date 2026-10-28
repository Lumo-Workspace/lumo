import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import {
  AGENT_IMPORT_MAX_BYTES,
  agentImportBodySchema,
} from '@/ee/security/validation/security-agent-import'
import { securityAgentImportService } from '@/ee/security/services/security-agent-import.service'

export const runtime = 'nodejs'

/**
 * POST /api/workspaces/me/security-scan/import — LUM-1321 `lumo security
 * import`: a Claude Code / Codex security review (SARIF 2.1.0, ≤1 MiB) joins
 * the scan of an open PR of the caller's workspace. Any member may import;
 * a scoped CI ingest key is refused by `requireIdentity` (it has its own
 * route). 202: the ingest runs in the background.
 */
export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > AGENT_IMPORT_MAX_BYTES) {
    return NextResponse.json(
      { error: 'Report is larger than 1 MiB' },
      { status: 413 }
    )
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = agentImportBodySchema.safeParse(json)
  if (!parsed.success) return zodError(parsed)

  try {
    const result = await securityAgentImportService.import(
      { workspaceId: identity.workspaceId, memberId: identity.memberId },
      parsed.data
    )
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[POST /api/workspaces/me/security-scan/import]'
    )
  }
}
