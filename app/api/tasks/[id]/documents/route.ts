import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id: rawId } = await params
  const memberId = ws.member.id

  let taskId: string = rawId

  // Resolve human-readable identifier (e.g. "LUM-42") to a cuid.
  if (!isLikelyCuid(rawId)) {
    const parsed = parseIdentifier(rawId)
    if (!parsed) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }
    const task = await taskRepository.findByWorkspaceIdentifier(
      ws.workspaceId,
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
    ws.workspaceId,
    memberId
  )

  const documents = mentions.map(m => m.document)

  return NextResponse.json({ documents })
}
