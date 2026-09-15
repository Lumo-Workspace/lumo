import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaSlackContextRepository } from '@/lib/repositories'
import { redactSlackSnapshotForInjection } from '@/lib/security-scan/inject-guard'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; contextId: string }> }

function errorResponse(err: unknown, route: string) {
  if (err instanceof Error && 'status' in err) {
    return NextResponse.json(
      { error: err.message },
      { status: (err as Error & { status: number }).status }
    )
  }
  console.error(`${route} error:`, err)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/**
 * GET /api/ideas/[id]/slack-contexts/[contextId]/snapshot
 * Returns the stored Slack thread snapshot (no network call). Mirrors the
 * task-side tier-2 retrieval (LUM-122). Scope is enforced by resolving the
 * idea first, then matching the context's ideaId.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, contextId } = await params
    const { ideaId } = await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const context = await ideaSlackContextRepository.getById(contextId)
    if (!context || context.ideaId !== ideaId)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // LUM-784: the stored bodies go straight into the agent's context via
    // `slack show` — redact every registry secret on the way out and tell the
    // CLI how many, so it can print the notice.
    const { snapshot, redactedSecrets } = redactSlackSnapshotForInjection(
      context.snapshot
    )
    return NextResponse.json({ snapshot, redactedSecrets })
  } catch (err) {
    return errorResponse(
      err,
      'GET /api/ideas/[id]/slack-contexts/[contextId]/snapshot'
    )
  }
}
