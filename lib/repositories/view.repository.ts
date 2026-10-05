import { prisma } from '@/lib/db/prisma'
import { ACTIVE_MEMBER } from '@/lib/members/deactivation'

// ── Types ───────────────────────────────────────────────────────────────────

export interface CreateViewData {
  workspaceId: string
  name: string
  type: string
  isDefault: boolean
  projectId?: string
  memberId?: string
}

// ── View Repository ────────────────────────────────────────────────────────

export const viewRepository = {
  /** Find a view by ID, including project and member workspace info. */
  async findById(viewId: string) {
    return prisma.view.findUnique({
      where: { id: viewId },
      include: {
        project: { select: { workspaceId: true } },
        member: { select: { workspaceId: true, clerkId: true } },
      },
    })
  },

  /** Find or create a KANBAN view for a member (personal "My Tasks" view). */
  async findOrCreateMemberKanban(workspaceId: string, memberId: string) {
    let view = await prisma.view.findFirst({
      where: { memberId, type: 'KANBAN' },
    })
    if (!view) {
      view = await prisma.view.create({
        data: {
          workspaceId,
          memberId,
          name: 'My Tasks',
          type: 'KANBAN',
          isDefault: false,
        },
      })
    }
    return view
  },

  /** Find or create a KANBAN view for a project. */
  async findOrCreateProjectKanban(workspaceId: string, projectId: string) {
    let view = await prisma.view.findFirst({
      where: { projectId, type: 'KANBAN' },
    })
    if (!view) {
      view = await prisma.view.create({
        data: {
          workspaceId,
          projectId,
          name: 'Board',
          type: 'KANBAN',
          isDefault: false,
        },
      })
    }
    return view
  },

  /** Get all task orders for a given view. */
  async findTaskOrders(viewId: string) {
    return prisma.viewTaskOrder.findMany({
      where: { viewId },
    })
  },

  /** Upsert a single task's order within a view. */
  async upsertTaskOrder(
    viewId: string,
    taskId: string,
    groupKey: string,
    order: number
  ) {
    return prisma.viewTaskOrder.upsert({
      where: { viewId_taskId: { viewId, taskId } },
      update: { order, groupKey },
      create: { viewId, taskId, groupKey, order },
    })
  },

  /** Find a member by workspace + clerkId (used for authorization). */
  async findMemberByWorkspaceAndClerkId(workspaceId: string, clerkId: string) {
    return prisma.workspaceMember.findFirst({
      where: { workspaceId, clerkId, ...ACTIVE_MEMBER },
    })
  },
}
