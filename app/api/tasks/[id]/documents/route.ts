import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { miscRepository, taskRepository } from '@/lib/repositories'
import { documentService } from '@/lib/services'
import { zodError } from '@/lib/api/helpers'
import {
  attachTaskDocumentBodySchema,
  resolveDocumentIdentifier,
} from '@/lib/validation/task-document'

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

/**
 * Task-side counterpart to `POST /api/documents/[id]/mentions`. The route
 * exists so the unified LinkContextPopover stays symmetric with the PR /
 * Slack / WebLink endpoints, all of which live under `/api/tasks/[id]/*`.
 * Heavy lifting (permission check, EXPLICIT vs CONTENT upgrade) is in
 * `documentService.addExplicitMention`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params

  // Validate the task exists and belongs to the caller's workspace before we
  // touch the body. Mirrors the GET path. We pass the human identifier
  // through — `addExplicitMention` re-resolves it via the same workspace-
  // scoped helper and uses the canonical form for logging / response payload.
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

  const body = await request.json().catch(() => null)
  const bodyParsed = attachTaskDocumentBodySchema.safeParse(body)
  if (!bodyParsed.success) return zodError(bodyParsed)

  let documentRef: string
  if (bodyParsed.data.documentId) {
    documentRef = bodyParsed.data.documentId
  } else {
    const resolved = resolveDocumentIdentifier(bodyParsed.data.identifier!)
    if (!resolved) {
      return NextResponse.json(
        { error: `Cannot resolve document: ${bodyParsed.data.identifier}` },
        { status: 404 }
      )
    }
    documentRef = resolved
  }

  try {
    const result = await documentService.addExplicitMention(
      documentRef,
      rawId,
      identity.workspaceId,
      identity.memberId
    )
    return NextResponse.json({
      documentId: result.documentId,
      alreadyBound: result.alreadyBound,
      upgradedFromContent: result.upgradedFromContent,
    })
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
