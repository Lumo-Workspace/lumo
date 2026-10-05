import { GENERATION_MODEL } from '@/lib/ai/models'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { clerkClient } from '@clerk/nextjs/server'
import { taskService } from '@/lib/services/task.service'
import {
  projectRepository,
  memberRepository,
  taskRepository,
} from '@/lib/repositories'
import { getHumanActorId } from '@/lib/actor'
import {
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
  QuickDispatchV2ResponseSchema,
  buildQuickDispatchV2Prompt,
} from '@/lib/prompts/quick-dispatch'
import { parseQuickDispatch } from '@/lib/quick-dispatch/rule-parser'
import type { QuickAction, Mention } from '@/lib/quick-dispatch/types'
import type { TaskStatus, TaskPriority } from '@prisma/client'

// ── Types ───────────────────────────────────────────────────────────────────

export type ActionResult = {
  type: 'update' | 'create'
  taskId: string | null
  taskIdentifier: string | null
  success: boolean
  message: string
  index: number
}

// ── Quick Dispatch Service ──────────────────────────────────────────────────

export const quickDispatchService = {
  /**
   * Execute a batch of quick dispatch actions (create / update tasks).
   * Returns an ActionResult for each action.
   */
  async executeActions(
    actions: Array<
      | {
          type: 'update'
          taskId: string
          fields: Record<string, unknown>
        }
      | {
          type: 'create'
          projectId: string
          title: string
          description?: string | undefined
          status: string
          priority: string
          assigneeActorId?: string | null | undefined
          dueDate?: string | null | undefined
        }
    >,
    workspaceId: string,
    actorId: string,
    actorClerkId: string
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = []

    // Pre-fetch taskCheck rows for every update action in one query so we can
    // call updateTaskWithSideEffects (which dispatches activity events,
    // real-time push, and notifications) without an extra DB round-trip per
    // action. Skipped when the batch has no updates.
    const updateIds = actions
      .filter(a => a.type === 'update')
      .map(a => (a as { taskId: string }).taskId)
    const taskChecks =
      updateIds.length > 0
        ? await taskRepository.findManyForUpdate(updateIds)
        : new Map()

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]!

      if (action.type === 'update') {
        const taskCheck = taskChecks.get(action.taskId)
        if (!taskCheck) {
          results.push({
            type: 'update',
            taskId: action.taskId,
            taskIdentifier: null,
            success: false,
            message: 'Task not found',
            index: i,
          })
          continue
        }
        try {
          await taskService.updateTaskWithSideEffects(
            action.taskId,
            action.fields,
            taskCheck,
            actorId,
            actorClerkId
          )

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
            workspaceId,
            projectId: action.projectId,
            teamId: project.teamId,
            title: action.title,
            description: action.description ?? null,
            status: action.status as TaskStatus,
            priority: action.priority as TaskPriority,
            assigneeActorId: action.assigneeActorId ?? actorId,
            agentStatus: null,
            order: undefined,
            dueDate: action.dueDate ? new Date(action.dueDate) : null,
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

    return results
  },

  /**
   * Parse user input via rule parser + AI fallback.
   * Returns merged actions and whether confirmation is needed.
   */
  async parseWithAI(
    input: string,
    workspaceId: string,
    userId: string,
    mentions?: Mention[]
  ): Promise<{ actions: QuickAction[]; needsConfirmation: boolean }> {
    // Step 1: Run rule parser
    const ruleResult = parseQuickDispatch(input, mentions ?? [])

    // Step 2: If unparsed text remains, call AI
    let aiActions: QuickAction[] = []

    if (ruleResult.unparsed) {
      const member = await memberRepository.findByWorkspaceAndClerkId(
        workspaceId,
        userId
      )
      if (!member) {
        throw Object.assign(new Error('Member not found'), { status: 404 })
      }
      const actorId = await getHumanActorId(member.id)
      if (!actorId) {
        throw Object.assign(new Error('Actor not found'), { status: 404 })
      }

      const [projects, memberRows, assignedTasks] = await Promise.all([
        projectRepository.findByWorkspaceNonIdea(workspaceId),
        memberRepository.findByWorkspace(workspaceId),
        taskRepository.findAssignedTasksSummary(actorId),
      ])

      // Build member names from Clerk
      const client = await clerkClient()
      const clerkUsers = await client.users.getUserList({
        userId: memberRows.map(m => m.clerkId),
        limit: 100,
      })
      const userMap = new Map(clerkUsers.data.map(u => [u.id, u]))

      const members = memberRows
        .filter(m => m.actor !== null)
        .map(m => {
          const u = userMap.get(m.clerkId)
          const trimmedName = u
            ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
            : ''
          const name =
            trimmedName || u?.emailAddresses[0]?.emailAddress || 'Unknown'
          return { name, actorId: m.actor!.id }
        })

      const userTasks = assignedTasks.map(t => ({
        id: t.id,
        identifier: `${t.team.identifier}-${t.number}`,
        title: t.title,
        status: t.status as 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE',
      }))

      const currentDate = new Date().toISOString().split('T')[0] ?? ''

      const prompt = buildQuickDispatchV2Prompt({
        input,
        projects,
        members,
        userTasks,
        currentDate,
      })

      const { object } = await generateObject({
        model: gateway(GENERATION_MODEL),
        schema: QuickDispatchV2ResponseSchema,
        system: QUICK_DISPATCH_V2_SYSTEM_PROMPT,
        prompt,
      })

      aiActions = object.actions.map(action => ({
        ...action,
        confidence: 'medium' as const,
      })) as QuickAction[]
    }

    // Step 3: Merge — rule actions first, deduplicate by taskId (rule wins)
    const seenTaskIds = new Set<string>()
    const allActions: QuickAction[] = []

    for (const action of ruleResult.actions) {
      if (action.type === 'update') {
        seenTaskIds.add(action.taskId)
      }
      allActions.push(action)
    }

    for (const action of aiActions) {
      if (action.type === 'update' && seenTaskIds.has(action.taskId)) {
        continue
      }
      allActions.push(action)
    }

    return {
      actions: allActions,
      needsConfirmation: allActions.length > 1 || aiActions.length > 0,
    }
  },
}
