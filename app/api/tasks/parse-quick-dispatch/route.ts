import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { clerkClient } from '@clerk/nextjs/server'

import { requireAuth } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { quickDispatchSchema } from '@/lib/validation/schemas'
import {
  QUICK_DISPATCH_SYSTEM_PROMPT,
  QuickDispatchResponseSchema,
  buildQuickDispatchPrompt,
} from '@/lib/prompts/quick-dispatch'

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = quickDispatchSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { input, workspaceUrl } = parsed.data

    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id

    // Fetch projects and members in parallel
    const [projects, memberRows] = await Promise.all([
      prisma.project.findMany({
        where: { workspaceId, isIdea: false },
        select: { id: true, name: true, description: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.workspaceMember.findMany({
        where: { workspaceId },
        include: {
          actor: { select: { id: true } },
        },
      }),
    ])

    // Fetch member names from Clerk
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

    const currentDate = new Date().toISOString().split('T')[0] ?? ''

    const prompt = buildQuickDispatchPrompt({
      input,
      projects,
      members,
      currentDate,
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: QuickDispatchResponseSchema,
      system: QUICK_DISPATCH_SYSTEM_PROMPT,
      prompt,
    })

    return NextResponse.json(object)
  } catch (error) {
    console.error('POST /api/tasks/parse-quick-dispatch error:', error)
    return NextResponse.json(
      { error: 'Failed to parse task input' },
      { status: 500 }
    )
  }
}
