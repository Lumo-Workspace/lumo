import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { mergeConfirmed } from '@/lib/services/memory/batch-consolidate.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

const bodySchema = z.object({
  /** The row kept ACTIVE (echoed for audit; not mutated). */
  canonicalId: z.string().min(1),
  /** The near-dup duplicates to merge away (archived, reversible). */
  supersededIds: z.array(z.string().min(1)).min(1),
})

/**
 * POST /api/projects/[id]/memories/merge — a human confirms a near-dup merge
 * from the batch consolidation sweep (LUM-541 P5). The superseded duplicates are
 * archived through the existing status machine (ACTIVE→ARCHIVED, reversible) —
 * 失效非删, never a hard delete; the canonical row is left ACTIVE.
 *
 * RED LINE (mirrors the LUM-540 retire / LUM-422 human-verdict routes): the
 * merge action is human-only. A bearer-token identity — the agent/CLI path — is
 * refused 403 BEFORE any write, so an agent can never collapse memories on its
 * own. Candidacy is computed by the sweep; the *action* needs a human.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'Memories can only be merged from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id } = await params
  const project = await projectRepository.findWorkspaceId(id)
  if (!project)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (project.workspaceId !== identity.workspaceId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const parsed = bodySchema.safeParse(await request.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const merged = await mergeConfirmed(
      parsed.data.supersededIds,
      identity.workspaceId
    )
    return NextResponse.json({ merged }, { status: 200 })
  } catch (error) {
    const maybeStatus = (error as { status?: unknown } | null)?.status
    const status = typeof maybeStatus === 'number' ? maybeStatus : 500
    const message =
      status === 500 || !(error instanceof Error)
        ? 'Internal Server Error'
        : error.message
    return NextResponse.json({ error: message }, { status })
  }
}
