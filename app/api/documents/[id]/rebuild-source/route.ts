import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { rebuildDocumentSourceSchema } from '@/lib/validation/schemas'
import { documentService } from '@/lib/services'
import { cliCommandNamesFromHeaders } from '@/lib/cli/command-names'

/**
 * Rebuild the markdown source from the stored HTML body (LUM-446).
 *
 * POST { allowShrink?, force?, ifRevision? } — serializes the doc's stored HTML
 * structure model back to markdown losslessly (tables round-trip) and backfills
 * `Document.sourceMarkdown`, re-enabling the markdown write paths
 * (raw/diff/section/append) for a source-less doc. The serialized source is
 * structure-guarded (422 on any table/tr/heading shrink) so a flattened source
 * can never be silently committed.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id } = await params

  // Body is optional — an empty POST means "rebuild with defaults".
  const raw = await request.json().catch(() => ({}))
  const parsed = rebuildDocumentSourceSchema.safeParse(raw ?? {})
  if (!parsed.success) return zodError(parsed)

  try {
    const document = await documentService.rebuildDocumentSource(
      id,
      identity.memberId,
      identity.workspaceId,
      {
        ...parsed.data,
        cliApproval: cliCommandNamesFromHeaders(request.headers)
          .rebuildSourceApproval,
      }
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
