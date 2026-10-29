import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1338 — reads of the workspace's stored AI feature switches
 * (`Workspace.aiFeatureSwitches`, raw JSON). No business rules here: parsing
 * and resolving live in lib/ai-features/registry.ts.
 */

export type AiFeatureSwitchRef =
  | { workspaceId: string }
  | { projectId: string }
  | { taskId: string }
  | { sessionId: string }
  | { milestoneId: string }

const select = { aiFeatureSwitches: true } as const

export const aiFeatureSwitchRepository = {
  /** The stored switches of the workspace `ref` belongs to; null when not found. */
  async findRaw(ref: AiFeatureSwitchRef): Promise<unknown | null> {
    if ('workspaceId' in ref) {
      const ws = await prisma.workspace.findUnique({
        where: { id: ref.workspaceId },
        select,
      })
      return ws ? ws.aiFeatureSwitches : null
    }
    if ('projectId' in ref) {
      const project = await prisma.project.findUnique({
        where: { id: ref.projectId },
        select: { workspace: { select } },
      })
      return project ? project.workspace.aiFeatureSwitches : null
    }
    if ('taskId' in ref) {
      const task = await prisma.task.findUnique({
        where: { id: ref.taskId },
        select: { project: { select: { workspace: { select } } } },
      })
      return task ? task.project.workspace.aiFeatureSwitches : null
    }
    if ('milestoneId' in ref) {
      const milestone = await prisma.milestone.findUnique({
        where: { id: ref.milestoneId },
        select: { project: { select: { workspace: { select } } } },
      })
      return milestone ? milestone.project.workspace.aiFeatureSwitches : null
    }
    const session = await prisma.session.findUnique({
      where: { id: ref.sessionId },
      select: { workspace: { select } },
    })
    return session?.workspace ? session.workspace.aiFeatureSwitches : null
  },
}
