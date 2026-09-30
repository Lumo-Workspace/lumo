import { GENERATION_MODEL } from '@/lib/ai/models'
import { generateObject } from 'ai'
import '@/lib/ai/gateway'
import { gateway } from '@/lib/ai/gateway'
import { z } from 'zod'

import { taskRepository, projectRepository } from '@/lib/repositories'
import { sanitizeHtml } from '@/lib/utils/sanitize'

// ── Zod response schemas ────────────────────────────────────────────────

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

// ── Prompt builders ─────────────────────────────────────────────────────

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

// ── Public service methods ──────────────────────────────────────────────

export type GenerateWithProjectResult = {
  description: string
}

export type GenerateWithoutProjectResult = {
  description: string
  suggestedProject?: {
    id: string
    name: string
    reason: string
  }
}

async function generateWithProject(
  title: string,
  projectId: string,
  project: { name: string; description: string | null },
  existingDescription?: string
): Promise<GenerateWithProjectResult> {
  const recentTasks = await taskRepository.findRecentByProject(projectId, 10)

  const prompt = buildPrompt({
    title,
    projectName: project.name,
    projectDescription: project.description ?? null,
    recentTasks,
    ...(existingDescription !== undefined ? { existingDescription } : {}),
  })

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: descriptionResponseSchema,
    prompt,
  })

  if (!object.description) {
    throw Object.assign(new Error('Failed to generate description'), {
      status: 500,
    })
  }

  return { description: sanitizeHtml(object.description) }
}

async function generateWithoutProject(
  title: string,
  workspaceId: string,
  existingDescription?: string
): Promise<GenerateWithoutProjectResult> {
  const projects = await projectRepository.findByWorkspaceNonIdea(workspaceId)

  if (projects.length === 0) {
    throw Object.assign(new Error('No projects found in workspace'), {
      status: 400,
    })
  }

  const prompt = buildPromptWithoutProject({
    title,
    projects,
    ...(existingDescription !== undefined ? { existingDescription } : {}),
  })

  const { object } = await generateObject({
    model: gateway(GENERATION_MODEL),
    schema: descriptionWithProjectSchema,
    prompt,
  })

  if (!object.description) {
    throw Object.assign(new Error('Failed to generate description'), {
      status: 500,
    })
  }

  const suggestedProject = projects.find(
    p => p.id === object.suggestedProjectId
  )

  return {
    description: sanitizeHtml(object.description),
    ...(suggestedProject && {
      suggestedProject: {
        id: suggestedProject.id,
        name: suggestedProject.name,
        reason: object.suggestedProjectReason,
      },
    }),
  }
}

export const descriptionService = {
  generateWithProject,
  generateWithoutProject,
}
