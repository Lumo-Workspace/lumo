import { prisma } from '@/lib/db/prisma'

export interface CreateIdeaPullRequestInput {
  ideaId: string
  pullRequestId: string
  workspaceId: string // denormalized for workspace-scoped queries; mirrors IdeaWebLink
  createdById: string // WorkspaceMember.id
}

/** The PR fields the idea evidence surface renders. Narrower than the full
 * `PullRequest` row (ISP) — the citation lists PRs, it does not manage them. */
const PR_SELECT = {
  id: true,
  repo: true,
  number: true,
  title: true,
  url: true,
  state: true,
  ciStatus: true,
  authorLogin: true,
} as const

export const ideaPullRequestRepository = {
  async create(input: CreateIdeaPullRequestInput) {
    return prisma.ideaPullRequest.create({ data: input })
  },

  async listByIdea(ideaId: string) {
    return prisma.ideaPullRequest.findMany({
      where: { ideaId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        pullRequest: { select: PR_SELECT },
      },
    })
  },

  async findByIdeaAndPr(ideaId: string, pullRequestId: string) {
    return prisma.ideaPullRequest.findUnique({
      where: { ideaId_pullRequestId: { ideaId, pullRequestId } },
    })
  },

  async getById(id: string) {
    return prisma.ideaPullRequest.findUnique({ where: { id } })
  },

  async delete(id: string) {
    return prisma.ideaPullRequest.delete({ where: { id } })
  },
}
