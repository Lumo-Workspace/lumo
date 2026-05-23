import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { miscRepository, taskRepository } from '@/lib/repositories'

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params

  let taskId: string = rawId

  // Resolve human-readable identifier (e.g. "LUM-42") to a cuid.
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
    taskId = task.id
  }

  const mentions = await miscRepository.findDocumentMentionsByTask(
    taskId,
    identity.workspaceId,
    identity.memberId
  )

  const documents = mentions.map(m => m.document)

  return NextResponse.json({ documents })
}
