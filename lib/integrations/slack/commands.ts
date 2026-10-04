import { prisma } from '@/lib/db/prisma'
import { transitionTaskStatus } from '@/lib/task/state-machine'
import { slugify } from '@/lib/utils/slugify'
import { CommandResult } from './types'
import { escapeMrkdwn } from './mrkdwn'
import { taskRepository } from '@/lib/repositories/task.repository'

// Resolve Slack user email → WorkspaceMember in workspaceId
async function resolveSlackUser(
  slackUserId: string,
  slackToken: string,
  workspaceId: string
) {
  const res = await fetch(
    `https://slack.com/api/users.info?user=${slackUserId}`,
    { headers: { Authorization: `Bearer ${slackToken}` } }
  )
  const data = await res.json()
  if (!data.ok || !data.user?.profile?.email) return null

  const email: string = data.user.profile.email

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { id: true, clerkId: true },
  })

  // Use Clerk backend API to match email → WorkspaceMember
  const { createClerkClient } = await import('@clerk/nextjs/server')
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! })
  for (const member of members) {
    const clerkUser = await clerk.users.getUser(member.clerkId)
    const primaryEmail = clerkUser.emailAddresses.find(
      e => e.id === clerkUser.primaryEmailAddressId
    )
    if (primaryEmail?.emailAddress === email) return member
  }
  return null
}

const TASK_IDENTIFIER_REGEX = /^([A-Za-z]{1,10})-(\d+)$/

function taskUrl(
  workspaceSlug: string,
  projectName: string,
  identifier: string
) {
  return `${process.env.NEXT_PUBLIC_APP_URL}/workspace/${workspaceSlug}/projects/${slugify(projectName)}/tasks/${identifier}`
}

function taskBlocks(task: {
  id: string
  number: number
  title: string
  status: string
  priority: string
  teamIdentifier: string
  workspaceSlug: string
  assigneeName?: string | null
  projectName?: string | null
}): object[] {
  const identifier = `${task.teamIdentifier}-${task.number}`
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        // LUM-928: stored names/titles are user-controlled — escape them.
        text: [
          `*${escapeMrkdwn(identifier)} · ${escapeMrkdwn(task.title)}*`,
          `Status: ${escapeMrkdwn(task.status)}   Priority: ${escapeMrkdwn(task.priority)}`,
          task.assigneeName
            ? `Assignee: ${escapeMrkdwn(task.assigneeName)}`
            : null,
          task.projectName
            ? `Project: ${escapeMrkdwn(task.projectName)}`
            : null,
        ]
          .filter(Boolean)
          .join('\n'),
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Open in Lumo ↗' },
        url: taskUrl(task.workspaceSlug, task.projectName ?? '', identifier),
      },
    },
  ]
}

async function findTaskByIdentifier(identifier: string, workspaceId: string) {
  const match = identifier.match(TASK_IDENTIFIER_REGEX)
  if (!match) return null
  const [, teamIdentifier, numberStr] = match
  const number = parseInt(numberStr!, 10)

  const team = await prisma.team.findFirst({
    where: { workspaceId, identifier: teamIdentifier!.toUpperCase() },
    select: { id: true },
  })
  if (!team) return null

  return prisma.task.findFirst({
    where: { teamId: team.id, number },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      priority: true,
      projectId: true,
      assigneeActorId: true,
      project: { select: { name: true } },
      team: {
        select: { identifier: true, workspace: { select: { slug: true } } },
      },
    },
  })
}

/** Echoes the user's own argument back — escaped so it stays literal text. */
function taskNotFound(identifier: string): CommandResult {
  return {
    type: 'text',
    text: `Task \`${escapeMrkdwn(identifier)}\` not found.`,
  }
}

const HELP_TEXT = `Available commands:
• \`status ENG-123\` — view task details
• \`assign ENG-123 @user\` — assign task
• \`done ENG-123\` — mark task as done
• \`in-review ENG-123\` — mark task as in review
• \`create "title" in TEAM\` — create a new task
• \`my-tasks\` — list your open tasks`

export async function handleCommand(
  text: string,
  slackUserId: string,
  slackToken: string,
  workspaceId: string
): Promise<CommandResult> {
  const parts = text.trim().split(/\s+/)
  const cmd = parts[0]?.toLowerCase()

  try {
    // ── status ENG-123 ──────────────────────────────────────────────────────
    if (cmd === 'status' && parts[1]) {
      const task = await findTaskByIdentifier(parts[1], workspaceId)
      if (!task) return taskNotFound(parts[1]!)
      return {
        type: 'blocks',
        blocks: taskBlocks({
          id: task.id,
          number: task.number,
          title: task.title,
          status: task.status,
          priority: task.priority,
          teamIdentifier: task.team.identifier,
          workspaceSlug: task.team.workspace.slug,
          projectName: task.project?.name,
        }),
      }
    }

    // ── done ENG-123 / in-review ENG-123 ───────────────────────────────────
    if ((cmd === 'done' || cmd === 'in-review') && parts[1]) {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member)
        return {
          type: 'text',
          text: `Your Slack account is not linked to a Lumo account in this workspace. Please use the same email in both.`,
        }

      const task = await findTaskByIdentifier(parts[1]!, workspaceId)
      if (!task) return taskNotFound(parts[1]!)

      const newStatus =
        cmd === 'done' ? ('DONE' as const) : ('IN_REVIEW' as const)
      await transitionTaskStatus(task.id, task.projectId, newStatus, {
        currentStatus: task.status,
      })
      return {
        type: 'text',
        text: `✅ ${escapeMrkdwn(`${task.team.identifier}-${task.number}`)} marked as ${cmd === 'done' ? 'Done' : 'In Review'}.`,
      }
    }

    // ── assign ENG-123 @user ────────────────────────────────────────────────
    if (cmd === 'assign' && parts[1] && parts[2]) {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member)
        return {
          type: 'text',
          text: `Your Slack account is not linked to a Lumo account.`,
        }

      const task = await findTaskByIdentifier(parts[1]!, workspaceId)
      if (!task) return taskNotFound(parts[1]!)

      // parts[2] is a Slack mention like <@U123456> or <@U123456|displayname>
      const mentionMatch = parts[2]!.match(/^<@([^|>]+)/)
      if (!mentionMatch)
        return { type: 'text', text: `Invalid user format. Use @username.` }
      const targetSlackId = mentionMatch[1]!

      const targetMember = await resolveSlackUser(
        targetSlackId,
        slackToken,
        workspaceId
      )
      if (!targetMember)
        return {
          type: 'text',
          text: `That user doesn't have a linked Lumo account.`,
        }

      // Resolve target member → Actor for assignment
      const { getHumanActorId } = await import('@/lib/actor')
      const targetActorId = await getHumanActorId(targetMember.id)
      await prisma.task.update({
        where: { id: task.id },
        data: { assigneeActorId: targetActorId },
      })
      return {
        type: 'text',
        text: `✅ ${escapeMrkdwn(`${task.team.identifier}-${task.number}`)} assigned.`,
      }
    }

    // ── create "title" in TEAM ──────────────────────────────────────────────
    if (cmd === 'create') {
      // Validate format before resolving user for a faster error response
      const titleMatch = text.match(/create\s+"([^"]+)"\s+in\s+([A-Za-z]+)/i)
      if (!titleMatch)
        return {
          type: 'text',
          text: `Usage: \`create "title" in TEAM\` (e.g. \`create "Fix bug" in ENG\`)`,
        }

      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member)
        return {
          type: 'text',
          text: `Your Slack account is not linked to a Lumo account.`,
        }
      const [, title, teamIdentifierRaw] = titleMatch
      const teamIdentifier = teamIdentifierRaw!.toUpperCase()

      const team = await prisma.team.findFirst({
        where: { workspaceId, identifier: teamIdentifier },
        select: {
          id: true,
          identifier: true,
          workspace: { select: { slug: true } },
        },
      })
      if (!team)
        return {
          type: 'text',
          text: `Team \`${escapeMrkdwn(teamIdentifier)}\` not found.`,
        }

      // Use the most recently updated project for this team as the default
      const project = await prisma.project.findFirst({
        where: { teamId: team.id },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true },
      })

      if (!project)
        return {
          type: 'text',
          text: `Team \`${escapeMrkdwn(team.identifier)}\` has no project to create the task in.`,
        }

      // Number comes from the team's atomic taskSeq — count+1 collides with
      // (or re-issues) numbers once any task has been hard-deleted (LUM-920).
      // createWithSequence also applies the task storage redaction.
      const task = await taskRepository.createWithSequence({
        projectId: project.id,
        teamId: team.id,
        title: title!,
        description: null,
        status: 'TODO',
        priority: 'MEDIUM',
        assigneeActorId: null,
        agentStatus: null,
        order: 0,
        dueDate: null,
      })

      const taskIdentifier = `${team.identifier}-${task.number}`
      const url = taskUrl(team.workspace.slug, project.name, taskIdentifier)
      return {
        type: 'blocks',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ Created *${escapeMrkdwn(taskIdentifier)} · ${escapeMrkdwn(title!)}*`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: 'Open in Lumo ↗' },
              url,
            },
          },
        ],
      }
    }

    // ── my-tasks ────────────────────────────────────────────────────────────
    if (cmd === 'my-tasks') {
      const member = await resolveSlackUser(
        slackUserId,
        slackToken,
        workspaceId
      )
      if (!member)
        return {
          type: 'text',
          text: `Your Slack account is not linked to a Lumo account.`,
        }

      const { getHumanActorId: getActorId } = await import('@/lib/actor')
      const memberActorId = await getActorId(member.id)
      const tasks = await prisma.task.findMany({
        where: {
          team: { workspaceId },
          assigneeActorId: memberActorId,
          status: { notIn: ['DONE'] },
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          priority: true,
          team: {
            select: {
              identifier: true,
              workspace: { select: { slug: true } },
            },
          },
          project: { select: { name: true } },
        },
      })

      if (tasks.length === 0)
        return { type: 'text', text: `You have no open tasks. 🎉` }

      return {
        type: 'blocks',
        blocks: tasks.map(t => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${escapeMrkdwn(`${t.team.identifier}-${t.number}`)}* · ${escapeMrkdwn(t.title)}\n${t.status} · ${t.priority}`,
          },
          accessory: {
            type: 'button',
            text: { type: 'plain_text', text: 'Open ↗' },
            url: taskUrl(
              t.team.workspace.slug,
              t.project.name,
              `${t.team.identifier}-${t.number}`
            ),
          },
        })),
      }
    }

    // ── unknown command ─────────────────────────────────────────────────────
    return { type: 'text', text: HELP_TEXT }
  } catch (error) {
    console.error('[slack command] error:', error)
    return { type: 'text', text: `Something went wrong. Please try again.` }
  }
}
