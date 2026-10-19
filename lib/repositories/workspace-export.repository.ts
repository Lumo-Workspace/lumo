import type { Prisma, WorkspaceExportStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-858: GDPR workspace export — the export audit rows, and paged reads of
 * the workspace data that goes into the archive.
 *
 * Every read is an explicit `select` allowlist: credential-bearing columns
 * (integration tokens, webhook secrets, invite tokens, `Document.publicToken`,
 * Google-sync pointers, embeddings) are never fetched, so they cannot leak
 * into an archive. `lib/workspace/export-coverage.ts` records which models are
 * exported at all.
 */

export const EXPORT_KINDS = [
  'teams',
  'members',
  'actors',
  'projects',
  'milestones',
  'sprints',
  'tasks',
  'comments',
  'task-artifacts',
  'task-dependencies',
  'priorities',
  'documents',
  'document-templates',
  'task-templates',
  'tags',
  'memories',
  'audit-events',
  'feedback',
] as const

export type ExportKind = (typeof EXPORT_KINDS)[number]
export type ExportRow = Record<string, unknown> & { id: string }

const ts = { createdAt: true, updatedAt: true } as const

/**
 * LUM-923: an export is the right of access to everything still stored, so
 * trashed tasks and documents are exported too (with their `deletedAt`) —
 * otherwise the comments / artifacts of a trashed task, read through relation
 * filters the soft-delete extension does not touch, point at no task row.
 * `deletedAt: {}` names the column, opting out of the default trash filter.
 */
const INCLUDING_TRASHED = { deletedAt: {} } as const

function paging(afterId: string | null, take: number) {
  return {
    orderBy: { id: 'asc' as const },
    take,
    ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
  }
}

async function pageRows(
  kind: ExportKind,
  workspaceId: string,
  afterId: string | null,
  take: number
): Promise<ExportRow[]> {
  const page = paging(afterId, take)
  const inWorkspaceProject = { project: { workspaceId } }
  const inWorkspaceTeam = { team: { workspaceId } }
  switch (kind) {
    case 'teams':
      return prisma.team.findMany({
        where: { workspaceId },
        select: {
          id: true,
          name: true,
          identifier: true,
          isDefault: true,
          timezone: true,
          ...ts,
        },
        ...page,
      })
    case 'members':
      return prisma.workspaceMember.findMany({
        where: { workspaceId },
        select: { id: true, clerkId: true, role: true, joinedAt: true },
        ...page,
      })
    case 'actors':
      return prisma.actor.findMany({
        where: { workspaceId },
        select: {
          id: true,
          type: true,
          memberId: true,
          agentId: true,
          externalIdentity: true,
        },
        ...page,
      })
    case 'projects':
      return prisma.project.findMany({
        where: { workspaceId },
        select: {
          id: true,
          teamId: true,
          name: true,
          description: true,
          isIdea: true,
          ownerId: true,
          createdByMemberId: true,
          ...ts,
        },
        ...page,
      })
    case 'milestones':
      return prisma.milestone.findMany({
        where: inWorkspaceProject,
        select: {
          id: true,
          projectId: true,
          name: true,
          slug: true,
          description: true,
          startDate: true,
          targetDate: true,
          completedAt: true,
          archivedAt: true,
          ...ts,
        },
        ...page,
      })
    case 'sprints':
      return prisma.sprint.findMany({
        where: inWorkspaceTeam,
        select: {
          id: true,
          teamId: true,
          number: true,
          name: true,
          status: true,
          startDate: true,
          endDate: true,
          startedAt: true,
          closedAt: true,
          ...ts,
        },
        ...page,
      })
    case 'tasks': {
      const rows = await prisma.task.findMany({
        where: { ...inWorkspaceProject, ...INCLUDING_TRASHED },
        select: {
          id: true,
          deletedAt: true,
          projectId: true,
          teamId: true,
          number: true,
          title: true,
          description: true,
          spec: true,
          status: true,
          priority: true,
          assigneeActorId: true,
          sprintId: true,
          milestoneId: true,
          dueDate: true,
          workStartedAt: true,
          claimSnapshot: true,
          ...ts,
          taskTags: { select: { tagId: true } },
        },
        ...page,
      })
      return rows.map(({ taskTags, ...t }) => ({
        ...t,
        tagIds: taskTags.map(tt => tt.tagId),
      }))
    }
    case 'comments':
      return prisma.comment.findMany({
        where: { deletedAt: null, task: inWorkspaceProject },
        select: {
          id: true,
          taskId: true,
          parentId: true,
          authorActorId: true,
          type: true,
          body: true,
          ...ts,
        },
        ...page,
      })
    case 'task-artifacts':
      return prisma.taskArtifact.findMany({
        where: { workspaceId },
        select: {
          id: true,
          taskId: true,
          kind: true,
          title: true,
          content: true,
          source: true,
          createdById: true,
          ...ts,
        },
        ...page,
      })
    case 'task-dependencies':
      return prisma.taskDependency.findMany({
        where: { workspaceId },
        select: {
          id: true,
          blockedTaskId: true,
          blockingTaskId: true,
          kind: true,
          source: true,
          status: true,
          reason: true,
          ...ts,
        },
        ...page,
      })
    case 'priorities':
      return prisma.priority.findMany({
        where: { workspaceId },
        select: {
          id: true,
          teamId: true,
          statement: true,
          effectiveFrom: true,
          declaredByMemberId: true,
          createdAt: true,
        },
        ...page,
      })
    case 'documents':
      return prisma.document.findMany({
        where: { workspaceId, ...INCLUDING_TRASHED },
        select: {
          id: true,
          deletedAt: true,
          number: true,
          slug: true,
          title: true,
          emoji: true,
          parentId: true,
          projectId: true,
          visibility: true,
          createdById: true,
          sourceMarkdown: true,
          content: true,
          ...ts,
        },
        ...page,
      })
    case 'document-templates':
      return prisma.documentTemplate.findMany({
        where: { workspaceId },
        select: { id: true, key: true, emoji: true, content: true, ...ts },
        ...page,
      })
    case 'task-templates':
      return prisma.taskTemplate.findMany({
        where: { workspaceId },
        select: { id: true, key: true, name: true, content: true, ...ts },
        ...page,
      })
    case 'tags':
      return prisma.tag.findMany({
        where: { workspaceId },
        select: { id: true, name: true, color: true, createdAt: true },
        ...page,
      })
    case 'memories':
      return prisma.memory.findMany({
        where: { workspaceId },
        select: {
          id: true,
          projectId: true,
          taskId: true,
          milestoneId: true,
          scope: true,
          category: true,
          status: true,
          content: true,
          createdByMemberId: true,
          supersededAt: true,
          ...ts,
        },
        ...page,
      })
    case 'audit-events':
      // LUM-907: the workspace audit log (already credential-redacted).
      return prisma.auditEvent.findMany({
        where: { workspaceId },
        select: {
          id: true,
          actorType: true,
          actorId: true,
          actorMemberId: true,
          action: true,
          targetType: true,
          targetId: true,
          source: true,
          ip: true,
          userAgent: true,
          metadata: true,
          createdAt: true,
        },
        ...page,
      })
    case 'feedback':
      // LUM-1240: reports the workspace sent to the Lumo team, with the
      // replies it received. Staff authors stay internal (customers see
      // "Lumo team"), so a reply carries only its body and time.
      return prisma.feedback.findMany({
        where: { workspaceId },
        select: {
          id: true,
          number: true,
          kind: true,
          status: true,
          title: true,
          steps: true,
          expected: true,
          actual: true,
          evidence: true,
          environment: true,
          taskRef: true,
          sessionId: true,
          submittedByMemberId: true,
          submittedVia: true,
          secretsRedacted: true,
          statusChangedAt: true,
          replies: {
            select: { body: true, createdAt: true },
            orderBy: { createdAt: 'asc' },
          },
          ...ts,
        },
        ...page,
      })
  }
}

const recordSelect = {
  id: true,
  workspaceId: true,
  requestedByClerkId: true,
  status: true,
  blobUrl: true,
  sizeBytes: true,
  rowCounts: true,
  error: true,
  completedAt: true,
  expiresAt: true,
  downloadCount: true,
  lastDownloadedAt: true,
  createdAt: true,
} satisfies Prisma.WorkspaceExportSelect

export type WorkspaceExportRecord = Prisma.WorkspaceExportGetPayload<{
  select: typeof recordSelect
}>

const ACTIVE: WorkspaceExportStatus[] = ['PENDING', 'RUNNING']

export const workspaceExportRepository = {
  pageRows,

  findWorkspaceMeta(workspaceId: string) {
    return prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, name: true, slug: true, createdAt: true },
    })
  },

  create(workspaceId: string, requestedByClerkId: string) {
    return prisma.workspaceExport.create({
      data: { workspaceId, requestedByClerkId },
      select: recordSelect,
    })
  },

  findActive(workspaceId: string) {
    return prisma.workspaceExport.findFirst({
      where: { workspaceId, status: { in: ACTIVE } },
      orderBy: { createdAt: 'desc' },
      select: recordSelect,
    })
  },

  findById(id: string) {
    return prisma.workspaceExport.findUnique({
      where: { id },
      select: recordSelect,
    })
  },

  listRecent(workspaceId: string, take: number) {
    return prisma.workspaceExport.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take,
      select: recordSelect,
    })
  },

  async setWorkflowRun(id: string, workflowRunId: string) {
    await prisma.workspaceExport.update({
      where: { id },
      data: { workflowRunId },
    })
  },

  /**
   * PENDING / RUNNING → RUNNING. False when the export was invalidated (or
   * deleted with its workspace) since it was read — LUM-923: never revive it.
   */
  async markRunning(id: string): Promise<boolean> {
    const { count } = await prisma.workspaceExport.updateMany({
      where: { id, status: { in: ACTIVE } },
      data: { status: 'RUNNING', error: null },
    })
    return count === 1
  },

  async markReady(
    id: string,
    data: {
      blobUrl: string
      sizeBytes: number
      rowCounts: Record<string, number>
      completedAt: Date
      expiresAt: Date
    }
  ): Promise<boolean> {
    // LUM-923: only a still-RUNNING export becomes READY. One invalidated by
    // a workspace deletion (or already gone with it) reports false so the
    // caller removes the archive it just uploaded.
    const { count } = await prisma.workspaceExport.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'READY', error: null, ...data },
    })
    return count === 1
  },

  /**
   * LUM-923: fail every in-flight export of a workspace about to be deleted,
   * so no run can turn one READY afterwards. Returns the invalidated ids.
   */
  async invalidateActive(workspaceId: string, error: string) {
    const rows = await prisma.workspaceExport.findMany({
      where: { workspaceId, status: { in: ACTIVE } },
      select: { id: true },
    })
    if (rows.length === 0) return []
    const ids = rows.map(r => r.id)
    await prisma.workspaceExport.updateMany({
      where: { id: { in: ids }, status: { in: ACTIVE } },
      data: { status: 'FAILED', error },
    })
    return ids
  },

  async markFailed(id: string, error: string) {
    await prisma.workspaceExport.update({
      where: { id },
      data: { status: 'FAILED', error, blobUrl: null },
    })
  },

  async markExpired(id: string) {
    await prisma.workspaceExport.update({
      where: { id },
      data: { status: 'EXPIRED', blobUrl: null },
    })
  },

  async recordDownload(id: string, clerkId: string, at: Date) {
    await prisma.workspaceExport.update({
      where: { id },
      data: {
        downloadCount: { increment: 1 },
        lastDownloadedAt: at,
        lastDownloadedByClerkId: clerkId,
      },
    })
  },
}
