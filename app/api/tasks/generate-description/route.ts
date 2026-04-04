import { NextResponse } from 'next/server'

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { prisma } from '@/lib/db/prisma'
import { generateDescriptionSchema } from '@/lib/validation/schemas'

const descriptionResponseSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
})

const ALLOWED_TAGS = new Set([
  'p',
  'strong',
  'em',
  'code',
  'ul',
  'ol',
  'li',
  'input',
  'br',
])

/** Strip all HTML tags except the allowed set. Removes all attributes except type/checked on input. */
function sanitizeHtml(html: string): string {
  return html.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g,
    (match, tag: string) => {
      const lower = tag.toLowerCase()
      if (!ALLOWED_TAGS.has(lower)) return ''
      // For input, only allow type="checkbox" and checked
      if (lower === 'input') return '<input type="checkbox">'
      // For closing tags, return as-is
      if (match.startsWith('</')) return `</${lower}>`
      // For opening tags, strip all attributes
      if (match.endsWith('/>')) return `<${lower} />`
      return `<${lower}>`
    }
  )
}

function buildPrompt({
  title,
  projectName,
  projectDescription,
  recentTasks,
  existingDescription,
}: {
  title: string
  projectName: string
  projectDescription: string | null
  recentTasks: { title: string; description: string | null }[]
  existingDescription?: string
}): string {
  const projectContext = projectDescription
    ? `<project_name>${projectName}</project_name>\n<project_description>${projectDescription}</project_description>`
    : `<project_name>${projectName}</project_name>`

  const recentTasksContext =
    recentTasks.length > 0
      ? `\n<recent_tasks>\n${recentTasks
          .map(t => `- ${t.title}${t.description ? `: ${t.description}` : ''}`)
          .join('\n')}\n</recent_tasks>`
      : ''

  if (existingDescription) {
    return `You are a project management assistant. Improve the following task description — make it more actionable, specific, and well-structured.

${projectContext}${recentTasksContext}

<task_title>${title}</task_title>
<current_description>${existingDescription}</current_description>

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">. Preserve the original intent but make it clearer and more actionable.`
  }

  return `You are a project management assistant. Generate a concise task description (1–2 sentences of execution instructions) for the following task.

${projectContext}${recentTasksContext}

<task_title>${title}</task_title>

Output lightweight HTML. You may use: <p>, <strong>, <code>, <ul>/<li> (for steps), <input type="checkbox"> (for checklists). Keep it actionable and concise — focus on HOW to execute, not WHAT the task is (the title already says that).`
}

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = generateDescriptionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { title, projectId, existingDescription } = parsed.data

    // Fetch project + verify membership (also serves as authorization)
    const projectResult = await loadProjectAndMember(projectId, userId)
    if (projectResult instanceof NextResponse) return projectResult
    const { project } = projectResult

    // Fetch recent tasks for context
    const recentTasks = await prisma.task.findMany({
      where: { projectId },
      select: { title: true, description: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    const prompt = buildPrompt({
      title,
      projectName: project.name,
      projectDescription: project.description ?? null,
      recentTasks,
      ...(existingDescription !== undefined ? { existingDescription } : {}),
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: descriptionResponseSchema,
      prompt,
    })

    if (!object.description) {
      return NextResponse.json(
        { error: 'Failed to generate description' },
        { status: 500 }
      )
    }

    return NextResponse.json({ description: sanitizeHtml(object.description) })
  } catch (error) {
    console.error('POST /api/tasks/generate-description error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}
