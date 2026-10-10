import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { resolveCrossingParam } from '@/lib/api/resolve-crossing-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { suppressionPreviewScopeSchema } from '@/lib/validation/boundary-crossing'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; crossingId: string }> }

/**
 * GET /api/tasks/[id]/boundary-crossings/[crossingId]/suppression-preview —
 * how many ALREADY-RECORDED open crossings in this project a repository
 * suppression rule built from this crossing would dispose (LUM-759). Read-only:
 * it creates no rule, writes no disposition and appends no activity.
 *
 * RED LINE (mirrors the disposition and revoke routes): this is the preview a
 * human reads before opting in, so it is scoped to the same audience. Bearer
 * identities — the agent/CLI path — are refused 403 BEFORE anything is read, so
 * an agent cannot use it to probe which of its crossings a rule would silence.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'The suppression preview is part of the human-only ruling flow — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  // LUM-963: preview the scope the human is about to pick.
  const scope = suppressionPreviewScopeSchema.safeParse(
    new URL(request.url).searchParams.get('scope') ?? undefined
  )
  if (!scope.success) {
    return NextResponse.json(
      { error: 'scope must be exact or directory' },
      { status: 400 }
    )
  }

  const { id: rawId, crossingId: rawCrossingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  // LUM-1059: accept the `<TEAM>-X<n>` ref; resolve to the cuid first.
  const crossingId = await resolveCrossingParam(rawCrossingId, task.id)

  try {
    const preview = await boundaryCrossingService.previewSuppressionScope(
      task.id,
      crossingId,
      scope.data
    )
    return NextResponse.json(preview)
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
