import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import type { LineageFragmentType } from '@prisma/client'

const mockMemory = jest.fn()
const mockPr = jest.fn()
const mockSlack = jest.fn()
const mockTodo = jest.fn()
const mockSession = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    memory: { findMany: (...a: any[]) => mockMemory(...a) },
    pullRequest: { findMany: (...a: any[]) => mockPr(...a) },
    taskSlackContext: { findMany: (...a: any[]) => mockSlack(...a) },
    taskWebLink: { findMany: jest.fn().mockResolvedValue([]) },
    taskFigmaLink: { findMany: jest.fn().mockResolvedValue([]) },
    prCommentMirror: { findMany: (...a: any[]) => mockTodo(...a) },
    session: { findMany: (...a: any[]) => mockSession(...a) },
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
  mockTodo.mockResolvedValue([])
  mockSession.mockResolvedValue([])
})

describe('lineageSourceRepository.labelsByType', () => {
  it('only queries the fragment types present, and keys labels by type::id', async () => {
    mockMemory.mockResolvedValue([
      {
        id: 'mem-1',
        scope: 'PROJECT',
        category: 'CONVENTION',
        content: { rule: 'Use the service layer', scope: 'all' },
      },
    ])
    mockPr.mockResolvedValue([
      { id: 'pr-1', number: 42, title: 'Add lineage table' },
    ])

    const refs = new Map<LineageFragmentType, string[]>([
      ['MEMORY', ['mem-1']],
      ['PR', ['pr-1']],
    ])
    const labels = await lineageSourceRepository.labelsByType(refs)

    expect(mockMemory).toHaveBeenCalledWith({
      where: { id: { in: ['mem-1'] } },
      select: { id: true, scope: true, category: true, content: true },
    })
    expect(mockSlack).not.toHaveBeenCalled()
    expect(labels.get('MEMORY::mem-1')).toContain('Use the service layer')
    expect(labels.get('PR::pr-1')).toBe('#42 Add lineage table')
  })

  it('LUM-1230: a memory label ends with `→ lumo memory show <short ref>`, not the cuid', async () => {
    const id = 'cmprcce99003304jrkp5brom5'
    mockMemory.mockResolvedValue([
      {
        id,
        scope: 'PROJECT',
        category: 'PROCEDURAL',
        content: { workflow: 'Add new HookEventType to timeline UI' },
      },
    ])
    const labels = await lineageSourceRepository.labelsByType(
      new Map<LineageFragmentType, string[]>([['MEMORY', [id]]])
    )
    const label = labels.get(`MEMORY::${id}`) ?? ''
    expect(label).toMatch(/→ lumo memory show kp5brom5$/)
    expect(label).not.toContain(id)
  })

  it('omits ids whose source row no longer exists', async () => {
    mockPr.mockResolvedValue([]) // pr-gone deleted
    const refs = new Map<LineageFragmentType, string[]>([['PR', ['pr-gone']]])
    const labels = await lineageSourceRepository.labelsByType(refs)
    expect(labels.has('PR::pr-gone')).toBe(false)
  })

  it('labels a PR_REVIEW_TODO with file path prefix and stripped/decoded body', async () => {
    mockTodo.mockResolvedValue([
      {
        id: 'todo-1',
        filePath: 'app/api/x.ts',
        comment: { body: '<p>Fix the <code>guard</code> &amp; retry</p>' },
      },
    ])
    const refs = new Map<LineageFragmentType, string[]>([
      ['PR_REVIEW_TODO', ['todo-1']],
    ])
    const labels = await lineageSourceRepository.labelsByType(refs)
    expect(labels.get('PR_REVIEW_TODO::todo-1')).toBe(
      'app/api/x.ts: Fix the guard & retry'
    )
  })

  it('labels a SESSION with short id and summaryType', async () => {
    mockSession.mockResolvedValue([
      { id: 'sess-abcdefgh-1234', summaryType: 'implementation' },
    ])
    const refs = new Map<LineageFragmentType, string[]>([
      ['SESSION', ['sess-abcdefgh-1234']],
    ])
    const labels = await lineageSourceRepository.labelsByType(refs)
    expect(labels.get('SESSION::sess-abcdefgh-1234')).toBe(
      'Session sess-abc (implementation)'
    )
  })
})
