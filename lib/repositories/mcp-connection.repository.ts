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

  /**
   * The user's most recently used other connection from a client of the same
   * name that has a workspace bound — what a re-registered client (new OAuth
   * client id, e.g. after the auth-provider switch, LUM-1073) inherits.
   */
  findLatestBoundSibling(
    clerkUserId: string,
    clientName: string,
    excludeId: string
  ) {
    return prisma.mcpConnection.findFirst({
      where: {
        clerkUserId,
        clientName,
        id: { not: excludeId },
        activeWorkspaceId: { not: null },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: { activeWorkspaceId: true },
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

  setActiveWorkspace(id: string, workspaceId: string, opts: { auto: boolean }) {
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
