import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { prisma } from '@/lib/db/prisma'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { updateTaskSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import {
  buildTaskNotificationCtx,
  dispatchTaskUpdateNotifications,
} from '@/lib/notifications/notifyTaskChange'
import { getHumanActorId } from '@/lib/actor'
import { getGithubInstallationToken } from '@/lib/github/auth'
import { pushTaskEvent, pushProjectEvent } from '@/lib/pusher/server'
import {
  isValidTaskTransition,
  type TaskStatusValue,
} from '@/lib/task/state-machine'

type Params = { params: Promise<{ id: string }> }

/**
 * Check if targetId is a descendant of ancestorId (prevent circular refs).
 */
async function isDescendant(
  ancestorId: string,
  targetId: string
): Promise<boolean> {
  const children = await prisma.task.findMany({
    where: { parentTaskId: ancestorId },
    select: { id: true },
  })

  for (const child of children) {
    if (child.id === targetId) return true
    if (await isDescendant(child.id, targetId)) return true
  }

  return false
}

/**
 * GET /api/tasks/[id] — Fetch a single task with full details.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            defaultReviewerId: true,
            repositories: {
              orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            },
          },
        },
        team: { select: { identifier: true } },
        assignee: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
            agent: { select: { id: true, name: true, avatarColor: true } },
          },
        },
        reviewer: {
          select: {
            id: true,
            type: true,
            member: { select: { id: true, clerkId: true } },
          },
        },
        pullRequests: {
          select: {
            id: true,
            number: true,
            title: true,
            url: true,
            state: true,
            authorLogin: true,
            headBranch: true,
            ciStatus: true,
            mergedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        branches: {
          select: {
            id: true,
            repo: true,
            branchName: true,
            lastCommitSha: true,
            lastCommitMessage: true,
            lastCommitAuthor: true,
            lastPushedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
        clarifies: {
          select: {
            id: true,
            question: true,
            context: true,
            reply: true,
            repliedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' as const },
        },
        agentRuns: {
          select: {
            id: true,
            runNumber: true,
            status: true,
            trigger: true,
            errorCode: true,
            errorMessage: true,
            summary: true,
            changedFiles: true,
            durationMs: true,
            prNumber: true,
            prUrl: true,
            branchName: true,
            startedAt: true,
            finishedAt: true,
          },
          orderBy: { runNumber: 'desc' as const },
        },
      },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    // Sync PR status from GitHub before responding
    const openPrs = task.pullRequests.filter(pr => pr.state === 'open')
    let taskStatus = task.status
    let pullRequests = task.pullRequests

    if (openPrs.length > 0) {
      const updates = await syncPullRequestStatus(openPrs)
      if (updates.size > 0) {
        pullRequests = task.pullRequests.map(pr => {
          const update = updates.get(pr.id)
          return update
            ? { ...pr, state: update.state, mergedAt: update.mergedAt }
            : pr
        })
        if ([...updates.values()].some(u => u.state === 'merged')) {
          taskStatus = 'DONE'
        }
      }
    }

    return NextResponse.json({
      task: {
        ...task,
        status: taskStatus,
        pullRequests,
        teamIdentifier: task.team.identifier,
      },
    })
  } catch (error) {
    console.error('GET /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

interface PrStatusUpdate {
  state: string
  mergedAt: Date | null
}

/**
 * Sync PR state from GitHub API for any PRs still marked 'open' in DB.
 * Returns a map of PR id → updated state so the caller can patch the response.
 */
async function syncPullRequestStatus(
  openPrs: { id: string; number: number; url: string; state: string }[]
): Promise<Map<string, PrStatusUpdate>> {
  const updates = new Map<string, PrStatusUpdate>()
  try {
    const token = await getGithubInstallationToken()

    for (const pr of openPrs) {
      // Extract owner/repo from PR URL: https://github.com/owner/repo/pull/N
      const match = pr.url.match(/github\.com\/([^/]+\/[^/]+)\/pull/)
      if (!match) continue
      const repo = match[1]

      const res = await fetch(
        `https://api.github.com/repos/${repo}/pulls/${pr.number}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: 'application/vnd.github.v3+json',
          },
        }
      )
      if (!res.ok) continue

      const ghPr = (await res.json()) as {
        state: string
        merged: boolean
        merged_at: string | null
        closed_at: string | null
        draft: boolean
      }

      const newState = ghPr.merged
        ? 'merged'
        : ghPr.state === 'closed'
          ? 'closed'
          : 'open'

      if (newState === pr.state) continue

      const mergedAt = ghPr.merged_at ? new Date(ghPr.merged_at) : null

      await prisma.pullRequest.update({
        where: { id: pr.id },
        data: {
          state: newState,
          mergedAt,
          closedAt: ghPr.closed_at ? new Date(ghPr.closed_at) : null,
          isDraft: ghPr.draft,
        },
      })

      updates.set(pr.id, { state: newState, mergedAt })
    }
  } catch (err) {
    console.error('[sync-pr] Failed to sync PR status:', err)
  }
  return updates
}

/**
 * PATCH /api/tasks/[id] — Update a task.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        project: {
          include: {
            defaultReviewer: { select: { id: true, clerkId: true } },
            workspace: { select: { slug: true } },
          },
        },
        team: { select: { identifier: true } },
      },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const body = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const {
      parentTaskId,
      assigneeActorId,
      reviewerActorId,
      projectId,
      repositoryId,
      ...rest
    } = parsed.data

    // Validate task status transition
    if (rest.status !== undefined && rest.status !== task.status) {
      if (
        !isValidTaskTransition(
          task.status as TaskStatusValue,
          rest.status as TaskStatusValue
        )
      ) {
        return NextResponse.json(
          {
            error: `Invalid status transition: ${task.status} → ${rest.status}`,
          },
          { status: 409 }
        )
      }
    }

    // Validate parentTaskId change
    if (parentTaskId !== undefined) {
      if (parentTaskId !== null) {
        // Can't be own parent
        if (parentTaskId === id) {
          return NextResponse.json(
            { error: 'A task cannot be its own parent' },
            { status: 400 }
          )
        }

        // Parent must be in the same project
        const parent = await prisma.task.findUnique({
          where: { id: parentTaskId },
        })
        if (!parent || parent.projectId !== task.projectId) {
          return NextResponse.json(
            { error: 'Parent task not found in this project' },
            { status: 400 }
          )
        }

        // Prevent circular reference: proposed parent must not be a descendant
        if (await isDescendant(id, parentTaskId)) {
          return NextResponse.json(
            { error: 'Cannot create circular parent reference' },
            { status: 400 }
          )
        }
      }
    }

    // Validate projectId belongs to the same workspace
    if (projectId !== undefined) {
      const newProject = await prisma.project.findUnique({
        where: { id: projectId },
      })
      if (!newProject || newProject.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Project not found in this workspace' },
          { status: 400 }
        )
      }
    }

    // Validate assigneeActorId belongs to the same workspace
    let newAssigneeType: 'HUMAN' | 'AGENT' | null = null
    if (assigneeActorId !== undefined && assigneeActorId !== null) {
      const actor = await prisma.actor.findUnique({
        where: { id: assigneeActorId },
        select: { type: true, workspaceId: true },
      })
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Assignee is not part of this workspace' },
          { status: 400 }
        )
      }
      newAssigneeType = actor.type
    }

    // Validate reviewerActorId belongs to the same workspace
    if (reviewerActorId !== undefined && reviewerActorId !== null) {
      const actor = await prisma.actor.findUnique({
        where: { id: reviewerActorId },
      })
      if (!actor || actor.workspaceId !== task.project.workspaceId) {
        return NextResponse.json(
          { error: 'Reviewer is not part of this workspace' },
          { status: 400 }
        )
      }
    }

    // Build update data explicitly to satisfy exactOptionalPropertyTypes
    const data: Record<string, unknown> = {}
    if (rest.title !== undefined) data.title = rest.title
    if (rest.description !== undefined) data.description = rest.description
    if (rest.spec !== undefined) data.spec = rest.spec
    if (rest.status !== undefined) data.status = rest.status
    if (rest.priority !== undefined) data.priority = rest.priority
    if (rest.order !== undefined) data.order = rest.order
    if (parentTaskId !== undefined) data.parentTaskId = parentTaskId
    if (assigneeActorId !== undefined) {
      data.assigneeActorId = assigneeActorId
      // Sync agentStatus when assignee type changes
      if (newAssigneeType === 'AGENT') {
        data.agentStatus = 'IDLE'
        data.agentError = null
      } else {
        // Reassigned to human or unassigned — clear agent state
        data.agentStatus = null
        data.agentError = null
      }
    }
    if (reviewerActorId !== undefined) data.reviewerActorId = reviewerActorId
    if (projectId !== undefined) data.projectId = projectId
    if (repositoryId !== undefined) data.repositoryId = repositoryId

    const updated = await prisma.task.update({
      where: { id },
      data,
      include: {
        project: { select: { id: true, name: true } },
        team: { select: { identifier: true } },
      },
    })

    const workspaceId = task.project.workspaceId

    // Push real-time task update event (detail page + board)
    const changedFields = Object.keys(data)
    waitUntil(
      Promise.all([
        pushTaskEvent(id, { type: 'task:updated', fields: changedFields }),
        pushProjectEvent(updated.projectId, {
          type: 'task:updated',
          taskId: id,
          fields: changedFields,
          patch: data,
        }),
      ])
    )

    // Resolve current user's Actor ID for notification triggers
    const triggerActorId = await getHumanActorId(memberResult.id)

    // ── Fire-and-forget notification side-effects ────────────────────────────
    if (parsed.data.status) {
      console.log(`[task status] ${id}: ${task.status} → ${parsed.data.status}`)
    }

    const ctx = buildTaskNotificationCtx(task, updated, triggerActorId, userId)
    dispatchTaskUpdateNotifications({
      ctx,
      taskId: id,
      oldStatus: task.status,
      newStatus: parsed.data.status,
      oldAssigneeActorId: task.assigneeActorId ?? null,
      newAssigneeActorId: parsed.data.assigneeActorId,
      updatedReviewerActorId: updated.reviewerActorId ?? null,
      workspaceId,
      triggerActorId,
    })

    return NextResponse.json({
      task: { ...updated, teamIdentifier: updated.team.identifier },
    })
  } catch (error) {
    console.error('PATCH /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/tasks/[id] — Delete a task.
 * Children get parentTaskId set to null (onDelete: SetNull).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const task = await prisma.task.findUnique({
      where: { id },
      include: { project: true },
    })
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      task.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    await prisma.task.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/tasks/[id] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
