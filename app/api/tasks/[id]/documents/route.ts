import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { miscRepository, taskRepository } from '@/lib/repositories'
import { documentService } from '@/lib/services'
import { zodError } from '@/lib/api/helpers'
import { attachTaskDocumentBodySchema } from '@/lib/validation/task-document'

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
 * Resolve a user-supplied document identifier (URL, cuid, or `slug-N`) to the
 * form `documentService.addExplicitMention` expects. The service itself
 * handles cuid + slug lookups via `documentRepository.findWithPermission`
 * (which already accepts either shape), so we just need to extract the
 * meaningful segment from URLs and pass non-URL inputs through.
 */
function resolveDocumentIdentifier(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // URL form — pull out the /documents/<slug-N> segment.
  if (trimmed.includes('/documents/')) {
    const m = trimmed.match(/\/documents\/([a-z0-9-]+-\d+)/i)
    if (m) return m[1]!
    return null
  }
  // Bare Prisma cuid (c + 24 alphanum) — passes straight to the service which
  // resolves cuid OR slug via documentRepository.findWithPermission.
  if (/^c[a-z0-9]{24}$/.test(trimmed)) return trimmed
  // Bare workspace slug like "sprint-notes-3".
  if (/^[a-z0-9-]+-\d+$/i.test(trimmed)) return trimmed
  return null
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
  // touch the body. Mirrors the GET path.
  let taskRef: string = rawId
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
    // Pass the human identifier through — `addExplicitMention` re-resolves it
    // via the same workspace-scoped helper and uses the canonical form for
    // logging / response payload.
    taskRef = rawId
  }

  const body = await request.json().catch(() => null)
  const parsed = attachTaskDocumentBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  let documentRef: string
  if (parsed.data.documentId) {
    documentRef = parsed.data.documentId
  } else {
    const resolved = resolveDocumentIdentifier(parsed.data.identifier!)
    if (!resolved) {
      return NextResponse.json(
        { error: `Cannot resolve document: ${parsed.data.identifier}` },
        { status: 404 }
      )
    }
    documentRef = resolved
  }

  try {
    const result = await documentService.addExplicitMention(
      documentRef,
      taskRef,
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
