import { prisma } from '@/lib/db/prisma'

/**
 * LUM-916 — the lookups that decide who may read a private upload. No
 * authorization logic here; `privateFileService` does the comparing.
 */
export const privateFileRepository = {
  /** The workspace owning a task, or null when the task is gone. */
  async findTaskWorkspaceId(taskId: string): Promise<string | null> {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { project: { select: { workspaceId: true } } },
    })
    return task?.project.workspaceId ?? null
  },

  /** A publicly shared document by its share token, with the bodies that may
   *  reference images. */
  async findSharedDocument(publicToken: string) {
    return prisma.document.findUnique({
      where: { publicToken },
      select: { workspaceId: true, content: true, sourceMarkdown: true },
    })
  },

  async taskHasTestCases(taskId: string): Promise<boolean> {
    return (await prisma.testCase.count({ where: { taskId } })) > 0
  },

  /** Tasks of a project that have (or had) test cases — their evidence
   *  prefixes are swept when the project is deleted. */
  async findTaskIdsWithTestCasesInProject(
    projectId: string
  ): Promise<string[]> {
    const rows = await prisma.task.findMany({
      where: { projectId, testCases: { some: {} } },
      select: { id: true },
    })
    return rows.map(r => r.id)
  },
}
