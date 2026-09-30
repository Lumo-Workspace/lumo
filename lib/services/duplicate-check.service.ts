import { GENERATION_MODEL } from '@/lib/ai/models'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { z } from 'zod'
import { taskRepository } from '@/lib/repositories'

const matchSchema = z.object({
  matches: z.array(
    z.object({
      taskId: z.string(),
      score: z.number().min(0).max(1),
    })
  ),
})

export interface DuplicateMatch {
  taskId: string
  title: string
  number: number
  teamIdentifier: string
  status: string
  score: number
  assigneeName: string | null
  priority: string
}

/**
 * Check for duplicate/similar tasks using AI semantic matching.
 * Returns up to 5 matches with score >= 0.4.
 */
export async function checkDuplicates(
  title: string,
  projectId: string
): Promise<DuplicateMatch[]> {
  const tasks = await taskRepository.findForDuplicateCheck(projectId)
  if (tasks.length === 0) return []

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
    model: gateway(GENERATION_MODEL),
    schema: matchSchema,
    prompt,
  })

  const taskMap = new Map(tasks.map(t => [t.id, t]))

  // Resolve assignee display names from Clerk
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

  return object.matches
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
}
