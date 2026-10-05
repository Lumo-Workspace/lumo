import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { moveDocumentSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params
  const body = await request.json()
  const parsed = moveDocumentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    // The service authorizes both the moved document and the target parent
    // (same workspace + editable) — LUM-990.
    const updated = await documentService.moveDocument(
      id,
      identity.memberId,
      identity.workspaceId,
      parsed.data
    )
    return NextResponse.json({ document: updated })
  } catch (error) {
    return serviceErrorResponse(error, 'PATCH /api/documents/[id]/move')
  }
}
