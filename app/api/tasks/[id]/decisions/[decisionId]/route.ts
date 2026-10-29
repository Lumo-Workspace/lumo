import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import {
  requireTaskMember,
  serviceErrorResponse,
  zodError,
} from '@/lib/api/helpers'
import { updateTaskDecisionSchema } from '@/lib/validation/task-decision'
import { taskDecisionService } from '@/lib/services/task-decision.service'

type Params = { params: Promise<{ id: string; decisionId: string }> }

/** PATCH /api/tasks/[id]/decisions/[decisionId] — edit text and/or rationale. */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { id, decisionId } = await params
    const access = await requireTaskMember(
      await taskRepository.findWithProjectWorkspaceId(id),
      authResult.userId
    )
    if (access instanceof NextResponse) return access
    const workspaceId = access.task.project.workspaceId

    const parsed = updateTaskDecisionSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) return zodError(parsed)

    const decision = await taskDecisionService.update({
      decisionId,
      taskId: id,
      workspaceId,
      actorMemberId: access.member.id,
      ...parsed.data,
    })
    return NextResponse.json({ decision })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[PATCH /api/tasks/[id]/decisions/[decisionId]]'
    )
  }
}

/** DELETE /api/tasks/[id]/decisions/[decisionId] */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { id, decisionId } = await params
    const access = await requireTaskMember(
      await taskRepository.findWithProjectWorkspaceId(id),
      authResult.userId
    )
    if (access instanceof NextResponse) return access
    const workspaceId = access.task.project.workspaceId

    await taskDecisionService.remove({
      decisionId,
      taskId: id,
      workspaceId,
      actorMemberId: access.member.id,
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    return serviceErrorResponse(
      error,
      '[DELETE /api/tasks/[id]/decisions/[decisionId]]'
    )
  }
}
