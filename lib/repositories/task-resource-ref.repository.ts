import { prisma } from '@/lib/db/prisma'

/** The task-attached resources a CLI short ref can name (LUM-1230). */
export type TaskResourceKind =
  | 'artifact'
  | 'webLink'
  | 'slackContext'
  | 'figmaLink'

/**
 * LUM-1230: the ids of one task's resources of `kind` — the candidate set a
 * short ref / id prefix is matched against. Scoped by `taskId` only; the
 * caller has already resolved the task inside the caller's workspace.
 */
export const taskResourceRefRepository = {
  async listIds(kind: TaskResourceKind, taskId: string): Promise<string[]> {
    const args = { where: { taskId }, select: { id: true } } as const
    const rows =
      kind === 'artifact'
        ? await prisma.taskArtifact.findMany(args)
        : kind === 'webLink'
          ? await prisma.taskWebLink.findMany(args)
          : kind === 'slackContext'
            ? await prisma.taskSlackContext.findMany(args)
            : await prisma.taskFigmaLink.findMany(args)
    return rows.map(r => r.id)
  },
}
