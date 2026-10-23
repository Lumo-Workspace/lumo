import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import {
  requireTaskMember,
  serviceErrorResponse,
  zodError,
} from '@/lib/api/helpers'
import { createTaskDecisionSchema } from '@/lib/validation/task-decision'
import { taskDecisionService } from '@/lib/services/task-decision.service'

type Params = { params: Promise<{ id: string }> }

/** GET /api/tasks/[id]/decisions — the task's decisions, oldest first (LUM-1303). */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { id } = await params
    const access = await requireTaskMember(
      await taskRepository.findWithProjectWorkspaceId(id),
      authResult.userId
    )
    if (access instanceof NextResponse) return access

    const decisions = await taskDecisionService.listForTask(
      id,
      access.task.project.workspaceId
    )
    return NextResponse.json({ decisions })
  } catch (error) {
    return serviceErrorResponse(error, '[GET /api/tasks/[id]/decisions]')
  }
}

/** POST /api/tasks/[id]/decisions — record a decision from the web. */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { id } = await params
    const access = await requireTaskMember(
      await taskRepository.findWithProjectWorkspaceId(id),
      authResult.userId
    )
    if (access instanceof NextResponse) return access

    const parsed = createTaskDecisionSchema.safeParse(
      await request.json().catch(() => null)
    )
    if (!parsed.success) return zodError(parsed)

    const decision = await taskDecisionService.create({
      taskId: id,
      workspaceId: access.task.project.workspaceId,
      text: parsed.data.text,
      rationale: parsed.data.rationale,
      createdById: access.member.id,
    })
    return NextResponse.json({ decision }, { status: 201 })
  } catch (error) {
    return serviceErrorResponse(error, '[POST /api/tasks/[id]/decisions]')
  }
}
