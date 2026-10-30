import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { feishuDocsImportService } from '@/lib/services/feishu-docs-import.service'
import { feishuDocErrorResponse } from '@/lib/api/feishu-doc-error'

/** LUM-1343: re-sync a Feishu-imported doc from Feishu (one way). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  try {
    const document = await feishuDocsImportService.resyncFeishuDoc(
      identity.workspaceId,
      identity.memberId,
      id,
      new URL(request.url).origin
    )
    return NextResponse.json({ document })
  } catch (error) {
    return feishuDocErrorResponse(error, 'POST /api/documents/[id]/sync-feishu')
  }
}
