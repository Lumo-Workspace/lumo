import { NextResponse } from 'next/server'

import { generateObject } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember, requireWorkspaceByUrl } from '@/lib/api/helpers'
import { generateDescriptionSchema } from '@/lib/validation/schemas'
import { taskRepository, projectRepository } from '@/lib/repositories'
import { sanitizeHtml } from '@/lib/utils/sanitize'

const descriptionResponseSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
})

const descriptionWithProjectSchema = z.object({
  description: z
    .string()
    .describe(
      'Generated HTML description using lightweight rich text tags: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">'
    ),
  suggestedProjectId: z
    .string()
    .describe(
      'The ID of the most relevant project for this task, chosen from the provided project list'
    ),
  suggestedProjectReason: z
    .string()
    .describe('A brief reason why this project was suggested'),
})

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

function buildPromptWithoutProject({
  title,
  projects,
  existingDescription,
}: {
  title: string
  projects: { id: string; name: string; description: string | null }[]
  existingDescription?: string
}): string {
  const projectList = projects
    .map(
      p =>
        `- id="${p.id}" name="${p.name}"${p.description ? ` description="${p.description}"` : ''}`
    )
    .join('\n')

  if (existingDescription) {
    return `You are a project management assistant. Improve the following task description — make it more actionable, specific, and well-structured.

<task_title>${title}</task_title>
<current_description>${existingDescription}</current_description>

Also, based on the task title and description, suggest the most relevant project from this list:
<projects>
${projectList}
</projects>

Output lightweight HTML for the description. You may use: <p>, <strong>, <code>, <ul>/<li>, <input type="checkbox">. Preserve the original intent but make it clearer and more actionable. Also output the suggestedProjectId and a brief reason.`
  }

  return `You are a project management assistant. Generate a concise task description (1–2 sentences of execution instructions) for the following task.

<task_title>${title}</task_title>

Also, based on the task title, suggest the most relevant project from this list:
<projects>
${projectList}
</projects>

Output lightweight HTML for the description. You may use: <p>, <strong>, <code>, <ul>/<li> (for steps), <input type="checkbox"> (for checklists). Keep it actionable and concise — focus on HOW to execute, not WHAT the task is (the title already says that). Also output the suggestedProjectId and a brief reason.`
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

    const { title, projectId, workspaceUrl, existingDescription } = parsed.data

    // ── With project: generate description with project context ──────────
    if (projectId) {
      const projectResult = await loadProjectAndMember(projectId, userId)
      if (projectResult instanceof NextResponse) return projectResult
      const { project } = projectResult

      const recentTasks = await taskRepository.findRecentByProject(
        projectId,
        10
      )

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

      return NextResponse.json({
        description: sanitizeHtml(object.description),
      })
    }

    // ── Without project: generate description + suggest project ──────────
    const wsResult = await requireWorkspaceByUrl(userId, workspaceUrl ?? null)
    if (wsResult instanceof NextResponse) return wsResult

    const workspaceId = wsResult.workspace.id
    const projects = await projectRepository.findByWorkspaceNonIdea(workspaceId)

    if (projects.length === 0) {
      return NextResponse.json(
        { error: 'No projects found in workspace' },
        { status: 400 }
      )
    }

    const prompt = buildPromptWithoutProject({
      title,
      projects,
      ...(existingDescription !== undefined ? { existingDescription } : {}),
    })

    const { object } = await generateObject({
      model: gateway('anthropic/claude-sonnet-4.5'),
      schema: descriptionWithProjectSchema,
      prompt,
    })

    if (!object.description) {
      return NextResponse.json(
        { error: 'Failed to generate description' },
        { status: 500 }
      )
    }

    // Verify the suggested project ID is valid
    const suggestedProject = projects.find(
      p => p.id === object.suggestedProjectId
    )

    return NextResponse.json({
      description: sanitizeHtml(object.description),
      ...(suggestedProject && {
        suggestedProject: {
          id: suggestedProject.id,
          name: suggestedProject.name,
          reason: object.suggestedProjectReason,
        },
      }),
    })
  } catch (error) {
    console.error('POST /api/tasks/generate-description error:', error)
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}
