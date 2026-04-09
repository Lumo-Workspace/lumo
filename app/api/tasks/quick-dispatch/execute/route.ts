import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { requireAuth } from '@/lib/auth'
import { zodError, requireWorkspaceByUrl } from '@/lib/api/helpers'
import { executeQuickDispatchSchema } from '@/lib/validation/schemas'
import { taskService } from '@/lib/services'
import {
  projectRepository,
  memberRepository,
  taskRepository,
} from '@/lib/repositories'
import { getHumanActorId } from '@/lib/actor'
import { pushProjectEvent } from '@/lib/pusher/server'

type ActionResult = {
  type: 'update' | 'create'
  taskId: string | null
  taskIdentifier: string | null
  success: boolean
  message: string
  index: number
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = executeQuickDispatchSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { actions, workspaceUrl } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    const member = await memberRepository.findByWorkspaceAndClerkId(
      workspaceId,
      userId
    )
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    const actorId = await getHumanActorId(member.id)
    if (!actorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 404 })
    }

    const results: ActionResult[] = []

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!

      if (action.type === 'update') {
        try {
          const result = await taskService.updateTask(
            action.taskId,
            action.fields
          )

          waitUntil(
            pushProjectEvent(result.task.projectId as string, {
              type: 'task:updated',
              taskId: action.taskId,
              fields: result.changedFields,
              patch: result.task,
            })
          )

          // TODO: Dispatch task update notifications (assignee change, status change, etc.)
          // Deferred because fetching full task detail before each update in a batch would be
          // expensive. See app/api/tasks/[id]/route.ts for the full notification pattern using
          // buildTaskNotificationCtx + dispatchTaskUpdateNotifications.

          results.push({
            type: 'update',
            taskId: action.taskId,
            taskIdentifier: null,
            success: true,
            message: 'Task updated successfully',
            index: i,
          })
        } catch (err) {
          const error = err as Error & { status?: number }
          results.push({
            type: 'update',
            taskId: action.taskId,
            taskIdentifier: null,
            success: false,
            message: error.message || 'Failed to update task',
            index: i,
          })
        }
      } else if (action.type === 'create') {
        try {
          const project = await projectRepository.findByIdSimple(
            action.projectId
          )
          if (!project) {
            results.push({
              type: 'create',
              taskId: null,
              taskIdentifier: null,
              success: false,
              message: 'Project not found',
              index: i,
            })
            continue
          }

          if (project.workspaceId !== workspaceId) {
            results.push({
              type: 'create',
              taskId: null,
              taskIdentifier: null,
              success: false,
              message: 'Project does not belong to this workspace',
              index: i,
            })
            continue
          }

          const task = await taskRepository.createWithSequence({
            projectId: action.projectId,
            teamId: project.teamId,
            title: action.title,
            description: action.description ?? null,
            status: action.status,
            priority: action.priority,
            assigneeActorId: action.assigneeActorId ?? actorId,
            agentStatus: null,
            reviewerActorId: null,
            parentTaskId: null,
            repositoryId: null,
            order: undefined,
            dueDate: action.dueDate ? new Date(action.dueDate) : null,
            defaultReviewerMemberId: null,
          })

          results.push({
            type: 'create',
            taskId: task.id,
            taskIdentifier: `${task.teamIdentifier}-${task.number}`,
            success: true,
            message: 'Task created successfully',
            index: i,
          })
        } catch (err) {
          const error = err as Error & { status?: number }
          results.push({
            type: 'create',
            taskId: null,
            taskIdentifier: null,
            success: false,
            message: error.message || 'Failed to create task',
            index: i,
          })
        }
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('POST /api/tasks/quick-dispatch/execute error:', error)
    return NextResponse.json(
      { error: 'Failed to execute quick dispatch actions' },
      { status: 500 }
    )
  }
}
