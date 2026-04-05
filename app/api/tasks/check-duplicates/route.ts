import { NextResponse } from 'next/server'
import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'
import { prisma } from '@/lib/db/prisma'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, zodError } from '@/lib/api/helpers'
import { checkDuplicatesSchema } from '@/lib/validation/schemas'

const matchSchema = z.object({
  matches: z.array(
    z.object({
      taskId: z.string(),
      score: z.number().min(0).max(1),
    })
  ),
})

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = checkDuplicatesSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { title, projectId } = parsed.data

    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult

    // Fetch tasks for this project (limit to 200 most recent)
    // TODO: When projects exceed 200 tasks, consider pre-filtering
    //       with full-text search before sending to AI
    const tasks = await prisma.task.findMany({
      where: { projectId },
      select: {
        id: true,
        title: true,
        number: true,
        status: true,
        priority: true,
        team: { select: { identifier: true } },
        assignee: {
          select: {
            type: true,
            member: { select: { clerkId: true } },
            agent: { select: { name: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })

    if (tasks.length === 0) {
      return NextResponse.json({ matches: [] })
    }

    // Build task list for AI prompt
    const taskList = tasks.map(t => `${t.id}: ${t.title}`).join('\n')

    const prompt = `You are a duplicate task detector for a project management system.
Given a new task title and a list of existing tasks, identify semantically similar or duplicate tasks.

New task title: <title>${title}</title>

Existing tasks:
<tasks>
${taskList}
</tasks>

Return tasks that are semantically similar, with a similarity score between 0 and 1.
Only include tasks with score >= 0.4. Focus on semantic meaning, not just keyword overlap.
A score of 1.0 means exact duplicate, 0.8+ means very similar, 0.5-0.8 means related.`

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: matchSchema,
      prompt,
    })

    // Build task lookup map
    const taskMap = new Map(tasks.map(t => [t.id, t]))

    // Resolve assignee display name from Clerk
    const clerkIds = tasks
      .filter(t => t.assignee?.type === 'HUMAN' && t.assignee.member?.clerkId)
      .map(t => t.assignee!.member!.clerkId)
    const uniqueClerkIds = [...new Set(clerkIds)]

    let clerkNameMap = new Map<string, string>()
    if (uniqueClerkIds.length > 0) {
      try {
        const { clerkClient } = await import('@clerk/nextjs/server')
        const client = await clerkClient()
        const users = await client.users.getUserList({
          userId: uniqueClerkIds,
          limit: uniqueClerkIds.length,
        })
        clerkNameMap = new Map(
          users.data.map(u => [
            u.id,
            [u.firstName, u.lastName].filter(Boolean).join(' ') ||
              u.username ||
              'Unknown',
          ])
        )
      } catch {
        // Clerk lookup failed, assignee names will be null
      }
    }

    const matches = object.matches
      .filter(m => m.score >= 0.4 && taskMap.has(m.taskId))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(m => {
        const t = taskMap.get(m.taskId)!
        let assigneeName: string | null = null
        if (t.assignee?.type === 'AGENT' && t.assignee.agent) {
          assigneeName = t.assignee.agent.name
        } else if (t.assignee?.type === 'HUMAN' && t.assignee.member?.clerkId) {
          assigneeName = clerkNameMap.get(t.assignee.member.clerkId) ?? null
        }

        return {
          taskId: t.id,
          title: t.title,
          number: t.number,
          teamIdentifier: t.team.identifier,
          status: t.status,
          score: m.score,
          assigneeName,
          priority: t.priority,
        }
      })

    return NextResponse.json({ matches })
  } catch (error) {
    console.error('[check-duplicates] error:', error)
    return NextResponse.json({ matches: [] })
  }
}
