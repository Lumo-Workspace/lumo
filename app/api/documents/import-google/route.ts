import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { importGoogleSchema } from '@/lib/validation/document'
import { googleDocsImportService } from '@/lib/services/google-docs-import.service'

export async function POST(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const parsed = importGoogleSchema.safeParse(
    await request.json().catch(() => null)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  try {
    const document = await googleDocsImportService.importGoogleDoc(
      identity.workspaceId,
      identity.memberId,
      {
        url: parsed.data.url,
        ...(parsed.data.visibility !== undefined
          ? { visibility: parsed.data.visibility }
          : {}),
      }
    )
    return NextResponse.json({ document })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    return NextResponse.json({ error: (error as Error).message }, { status })
  }
}
