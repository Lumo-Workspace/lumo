import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireIdentity } from '@/lib/auth'
import { projectRepository, memoryRepository } from '@/lib/repositories'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  candidates: z
    .array(
      z.object({
        memoryId: z.string().min(1),
        deadAnchors: z
          .array(
            z.object({
              kind: z.enum(['file', 'symbol', 'flag']),
              value: z.string().min(1),
            })
          )
          .min(1),
      })
    )
    .max(2000),
})

/**
 * POST /api/projects/[id]/memories/stale-anchors — `lumo memory sync` reports
 * the memories whose every code anchor is gone from the dev's repo (LUM-547
 * P4b). Detection runs client-side (the server has no checkout); this route just
 * persists the finding (`MemoryStaleAnchorReport`, upsert per memory) so the
 * P4a retire pool can surface it with evidence.
 *
 * This is the agent/CLI write path — bearer auth is fine. It records CANDIDACY
 * only and NEVER mutates memory status: archival stays the human-only
 * .../retire route. A candidate that points at a memory outside this project is
 * inert (the pool only ranks the project's ACTIVE memories).
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const project = await projectRepository.findWorkspaceId(id)
    if (!project)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const json = await request.json().catch(() => null)
    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const sessionId = request.headers.get('x-lumo-session-id')
    let recorded = 0
    for (const candidate of parsed.data.candidates) {
      await memoryRepository.upsertStaleAnchorReport({
        memoryId: candidate.memoryId,
        projectId: id,
        workspaceId: identity.workspaceId,
        deadAnchors: candidate.deadAnchors,
        reportedBySession: sessionId,
      })
      recorded++
    }

    return NextResponse.json({ recorded })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error(
      'POST /api/projects/[id]/memories/stale-anchors error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
