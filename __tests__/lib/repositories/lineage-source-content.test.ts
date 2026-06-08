import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: { findMany: jest.fn().mockResolvedValue([]) },
    taskSlackContext: { findMany: jest.fn().mockResolvedValue([]) },
    taskWebLink: { findMany: jest.fn().mockResolvedValue([]) },
    taskFigmaLink: { findMany: jest.fn().mockResolvedValue([]) },
    pullRequest: { findMany: jest.fn().mockResolvedValue([]) },
    prCommentMirror: { findMany: jest.fn().mockResolvedValue([]) },
    session: { findMany: jest.fn().mockResolvedValue([]) },
  },
}))

describe('contentByType', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns full (untruncated) PR_REVIEW_TODO comment body', async () => {
    ;(prisma.prCommentMirror.findMany as jest.Mock).mockResolvedValue([
      { id: 't1', filePath: 'lib/x.ts', comment: { body: 'A'.repeat(300) } },
    ])
    const out = await lineageSourceRepository.contentByType(
      new Map([['PR_REVIEW_TODO', ['t1']]])
    )
    const text = out.get('PR_REVIEW_TODO::t1')!
    expect(text).toContain('lib/x.ts')
    expect(text.length).toBeGreaterThan(250) // not truncated to 80
  })

  it('keys web links by id with title + url', async () => {
    ;(prisma.taskWebLink.findMany as jest.Mock).mockResolvedValue([
      { id: 'w1', title: 'Neon pooling', url: 'https://neon.tech/x' },
    ])
    const out = await lineageSourceRepository.contentByType(
      new Map([['WEB_LINK', ['w1']]])
    )
    expect(out.get('WEB_LINK::w1')).toBe('Neon pooling — https://neon.tech/x')
  })

  it('only queries types present in the input map', async () => {
    await lineageSourceRepository.contentByType(new Map([['MEMORY', ['m1']]]))
    expect(prisma.memory.findMany).toHaveBeenCalled()
    expect(prisma.taskWebLink.findMany).not.toHaveBeenCalled()
  })
})
