// LUM-1096: the Prisma queries behind the Slack `/lumo` and `@Lumo` commands,
// moved out of lib/integrations/slack/commands.ts. Every query pins the
// workspace the Slack install belongs to (LUM-979 scoped client).
import { scopedPrisma as prisma } from '@/lib/db/workspace-scope'
import { ACTIVE_MEMBER } from '@/lib/members/deactivation'

const TASK_SUMMARY_SELECT = {
  id: true,
  number: true,
  title: true,
  status: true,
  priority: true,
  projectId: true,
  project: { select: { name: true } },
  team: {
    select: { identifier: true, workspace: { select: { slug: true } } },
  },
} as const

export const slackCommandRepository = {
  /**
   * The workspace's active members among the given auth-provider user ids,
   * with their actor id (LUM-1115: the caller already narrowed the ids to the
   * directory users that own an email, so this never lists the whole roster).
   */
  async listActiveMembersByClerkIds(workspaceId: string, clerkIds: string[]) {
    if (clerkIds.length === 0) return []
    return prisma.workspaceMember.findMany({
      where: { workspaceId, clerkId: { in: clerkIds }, ...ACTIVE_MEMBER },
      select: { id: true, clerkId: true, actor: { select: { id: true } } },
    })
  },

  /** A team by its identifier (already upper-cased by the caller). */
  async findTeamByIdentifier(workspaceId: string, identifier: string) {
    return prisma.team.findFirst({
      where: { workspaceId, identifier },
      select: {
        id: true,
        identifier: true,
        workspace: { select: { slug: true } },
      },
    })
  },

  /** One task by team + number, with what the `status` reply shows. */
  async findTaskByNumber(workspaceId: string, teamId: string, number: number) {
    return prisma.task.findFirst({
      where: { workspaceId, teamId, number },
      select: {
        ...TASK_SUMMARY_SELECT,
        assignee: {
          select: {
            type: true,
            memberId: true,
            externalIdentity: true,
            agent: { select: { name: true } },
          },
        },
      },
    })
  },

  /**
   * The pre-update view of a task that the shared task update service
   * (`updateTaskWithSideEffects`) diffs against for its activity events.
   */
  async findTaskForUpdate(workspaceId: string, taskId: string) {
    return prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      select: {
        id: true,
        projectId: true,
        number: true,
        title: true,
        priority: true,
        dueDate: true,
        description: true,
        project: { select: { name: true, workspaceId: true } },
      },
    })
  },

  /** The team's most recently updated project — `create`'s default. */
  async findLatestProjectForTeam(workspaceId: string, teamId: string) {
    return prisma.project.findFirst({
      where: { workspaceId, teamId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true },
    })
  },

  /**
   * The actor's open (not DONE) tasks, most recently updated first, capped at
   * `take` — plus the uncapped total, so the reply can say "5 of N".
   */
  async listOpenTasksForAssignee(
    workspaceId: string,
    actorId: string,
    take: number
  ) {
    const where = {
      workspaceId,
      assigneeActorId: actorId,
      status: { notIn: ['DONE' as const] },
    }
    const [tasks, total] = await Promise.all([
      prisma.task.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take,
        select: TASK_SUMMARY_SELECT,
      }),
      prisma.task.count({ where }),
    ])
    return { tasks, total }
  },
}
