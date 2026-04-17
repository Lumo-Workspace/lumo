import { prisma } from '@/lib/db/prisma'

export interface UpsertOnConnectInput {
  clerkUserId: string
  clientId: string
  clientName: string | null
}

export const mcpConnectionRepository = {
  findByClerkUserAndClient(clerkUserId: string, clientId: string) {
    return prisma.mcpConnection.findUnique({
      where: { clerkUserId_clientId: { clerkUserId, clientId } },
    })
  },

  findById(id: string) {
    return prisma.mcpConnection.findUnique({ where: { id } })
  },

  listActiveByClerkUser(clerkUserId: string) {
    return prisma.mcpConnection.findMany({
      where: { clerkUserId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    })
  },

  upsertOnConnect(input: UpsertOnConnectInput) {
    return prisma.mcpConnection.upsert({
      where: {
        clerkUserId_clientId: {
          clerkUserId: input.clerkUserId,
          clientId: input.clientId,
        },
      },
      create: {
        clerkUserId: input.clerkUserId,
        clientId: input.clientId,
        clientName: input.clientName,
      },
      update: {
        clientName: input.clientName,
        lastUsedAt: new Date(),
        revokedAt: null,
      },
    })
  },

  setActiveWorkspace(
    id: string,
    workspaceId: string,
    opts: { auto: boolean }
  ) {
    return prisma.mcpConnection.update({
      where: { id },
      data: {
        activeWorkspaceId: workspaceId,
        autoBoundAt: opts.auto ? new Date() : null,
      },
    })
  },

  touchLastUsed(id: string) {
    return prisma.mcpConnection.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    })
  },

  revoke(id: string) {
    return prisma.mcpConnection.update({
      where: { id },
      data: { revokedAt: new Date(), activeWorkspaceId: null },
    })
  },
}
