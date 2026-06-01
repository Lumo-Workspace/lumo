import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { googleDocsImportService } from '@/lib/services/google-docs-import.service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  try {
    const document = await googleDocsImportService.resyncGoogleDoc(
      identity.workspaceId,
      identity.memberId,
      id
    )
    return NextResponse.json({ document })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return NextResponse.json({ error: (error as Error).message }, { status })
  }
}
