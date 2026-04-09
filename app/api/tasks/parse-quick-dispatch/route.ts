import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { clerkClient } from '@clerk/nextjs/server'

import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { quickDispatchV2Schema } from '@/lib/validation/schemas'
import {
  QUICK_DISPATCH_V2_SYSTEM_PROMPT,
  QuickDispatchV2ResponseSchema,
  buildQuickDispatchV2Prompt,
} from '@/lib/prompts/quick-dispatch'
import {
  projectRepository,
  memberRepository,
  taskRepository,
} from '@/lib/repositories'
import { parseQuickDispatch } from '@/lib/quick-dispatch/rule-parser'
import { getHumanActorId } from '@/lib/actor'
import type { QuickAction } from '@/lib/quick-dispatch/types'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = quickDispatchV2Schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { input, workspaceUrl, mentions } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    // Step 1: Run rule parser
    const ruleResult = parseQuickDispatch(input, mentions)

    // Step 2: If unparsed text remains, call AI
    let aiActions: QuickAction[] = []

    if (ruleResult.unparsed) {
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
        model: gateway('anthropic/claude-sonnet-4.5'),
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

    return NextResponse.json({
      actions: allActions,
      needsConfirmation: allActions.length > 1 || aiActions.length > 0,
    })
  } catch (error) {
    console.error('POST /api/tasks/parse-quick-dispatch error:', error)
    return NextResponse.json(
      { error: 'Failed to parse task input' },
      { status: 500 }
    )
  }
}
