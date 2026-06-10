import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { editDocumentSectionSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'

/**
 * Section-addressed body edit (LUM-409).
 *
 * POST { mode: 'replace' | 'append', section?, contentMarkdown, ifRevision? }
 * Splices into the stored markdown source on heading boundaries and commits
 * conditionally on contentRevision — a concurrent body write returns 409
 * instead of silently last-write-winning.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  const body = await request.json()
  const parsed = editDocumentSectionSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const document = await documentService.editDocumentSection(
      id,
      identity.memberId,
      identity.workspaceId,
      parsed.data
    )
    return NextResponse.json({ document })
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
