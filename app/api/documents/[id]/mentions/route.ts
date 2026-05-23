import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createDocumentMentionSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params
  const body = await request.json()
  const parsed = createDocumentMentionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const mention = await documentService.addExplicitMention(
      id,
      parsed.data.taskIdentifier,
      identity.workspaceId,
      identity.memberId
    )
    return NextResponse.json({ mention }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
