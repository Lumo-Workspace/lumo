import { prisma } from '@/lib/db/prisma'

interface PrStateUpdate {
  state: string
  mergedAt: Date | null
  closedAt: Date | null
  isDraft: boolean
}

export const pullRequestRepository = {
  /** Update a PR's state and timestamps. */
  async updateState(id: string, data: PrStateUpdate) {
    return prisma.pullRequest.update({ where: { id }, data })
  },
}
