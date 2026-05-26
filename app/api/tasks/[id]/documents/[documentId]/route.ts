import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { documentService } from '@/lib/services'

/** Returns true when the segment looks like a Prisma cuid (c + 24 alphanum chars). */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

/**
 * Parse a "LUM-42"-style identifier into its components.
 * Returns null if the string doesn't match the pattern.
 */
function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

/**
 * Task-side counterpart to the doc-side `DELETE /api/documents/[id]/mentions/[taskId]`.
 * Removes an EXPLICIT mention; refuses (409) when the mention is CONTENT-only
 * (i.e. came from `@LUM-N` in the doc body — the user has to edit the doc to
 * unbind those). Heavy lifting lives in `documentService.removeExplicitMention`.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, documentId } = await params

  // Validate the task exists and belongs to the caller's workspace before we
  // hit the service. Mirrors the GET/POST path in the sibling route file. We
  // pass the human identifier through — the service re-resolves it via the
  // same workspace-scoped helper and uses the canonical form for the response.
  if (!isLikelyCuid(rawId)) {
    const parsed = parseIdentifier(rawId)
    if (!parsed) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const task = await taskRepository.findByWorkspaceIdentifier(
      identity.workspaceId,
      parsed.teamIdentifier,
      parsed.number
    )
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
  }

  try {
    const result = await documentService.removeExplicitMention(
      documentId,
      rawId,
      identity.workspaceId,
      identity.memberId
    )
    if (result.refused) {
      return NextResponse.json(
        { error: result.reason, code: 'CONTENT_MENTION_ONLY' },
        { status: 409 }
      )
    }
    return NextResponse.json({ removed: result.removed })
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
