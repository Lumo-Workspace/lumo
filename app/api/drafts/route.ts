import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireIdentity } from '@/lib/auth/identity'
import { requireWorkspaceByUrl, zodError } from '@/lib/api/helpers'
import { memberRepository } from '@/lib/repositories/member.repository'
import { draftService } from '@/lib/services/draft.service'
import {
  upsertDraftSchema,
  taskDraftDataSchema,
  projectDraftDataSchema,
} from '@/lib/validation/schemas'

/**
 * GET /api/drafts — the caller's own drafts in the credential's workspace.
 *
 * LUM-1192: browser session or API key (`lumo draft list`). Drafts are
 * personal: only rows the caller's Actor created are returned. The optional
 * `workspaceUrl` must name the credential's workspace (a Bearer key's own, or
 * the session's active one), else 404 — it never moves the scope.
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
    if (workspaceUrl && workspaceUrl !== identity.workspaceSlug) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      )
    }

    const actor = await memberRepository.findActorByMemberId(identity.memberId)
    if (!actor) {
      return NextResponse.json({ drafts: [] })
    }

    const drafts = await draftService.listDrafts(identity.workspaceId, actor.id)

    return NextResponse.json({ drafts })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = upsertDraftSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { id, workspaceUrl, type, data } = parsed.data

    // Validate data shape based on type
    const dataSchema =
      type === 'TASK' ? taskDraftDataSchema : projectDraftDataSchema
    const dataParsed = dataSchema.safeParse(data)
    if (!dataParsed.success) return zodError(dataParsed)

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const { member } = wsResult

    const actor = await memberRepository.findActorByMemberId(member.id)
    if (!actor) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    try {
      const draft = await draftService.upsertDraft({
        id,
        workspaceId: wsResult.workspace.id,
        creatorId: actor.id,
        type,
        data: dataParsed.data,
      })
      return NextResponse.json({ draft }, { status: id ? 200 : 201 })
    } catch (err) {
      const error = err as Error & { status?: number }
      if (error.status === 404) {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      throw err
    }
  } catch (err) {
    console.error('[POST /api/drafts]', err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
