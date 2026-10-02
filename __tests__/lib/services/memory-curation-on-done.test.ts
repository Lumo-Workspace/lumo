/**
 * @jest-environment node
 *
 * LUM-544 §1 — DONE-time Layer-1 memory curation. An LLM judge reviews the
 * memories each session recorded and SOFT-invalidates only the clearly-wrong
 * ones; uncertain memories are left untouched and nothing is hard-deleted.
 */
const judgeMemoryCuration = jest.fn()
jest.mock('@/lib/services/memory/curation-judge', () => ({
  judgeMemoryCuration: (...a: unknown[]) => judgeMemoryCuration(...a),
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findBySourceSessionId: jest.fn(),
    invalidate: jest.fn(),
    delete: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
    listEventsForSession: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { getTitleAndStatus: jest.fn() },
}))
jest.mock('@/lib/services/session-summary/compact-events', () => ({
  compactEvents: () => ({
    text: 'ran tests; they failed',
    droppedToolCalls: 0,
  }),
}))
jest.mock('@/lib/memory/content-text', () => ({
  memoryContentToText: (_cat: unknown, content: unknown) =>
    typeof content === 'object' && content
      ? String((content as { fact?: string }).fact ?? '')
      : String(content),
}))

import { memoryCurationService } from '@/lib/services/memory/curation.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const findMem = memoryRepository.findBySourceSessionId as jest.Mock
const invalidate = memoryRepository.invalidate as jest.Mock
const hardDelete = memoryRepository.delete as jest.Mock
const listForTask = sessionRepository.listForTask as jest.Mock
const listEvents = sessionRepository.listEventsForSession as jest.Mock
const getTitle = taskRepository.getTitleAndStatus as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  getTitle.mockResolvedValue({ title: 'Wire up OAuth', status: 'DONE' })
  listForTask.mockResolvedValue([{ id: 'sess1' }])
  listEvents.mockResolvedValue([{ type: 'POST_TOOL_USE' }])
  invalidate.mockResolvedValue(1)
})

it('Layer1 curation invalidates clearly-wrong memories on DONE without hard delete', async () => {
  // Three memories: m_wrong is clearly wrong, m_ok + m_uncertain are not flagged.
  findMem.mockResolvedValue([
    { id: 'm_wrong', category: 'GOTCHA', content: { fact: 'tests pass' } },
    { id: 'm_ok', category: 'GOTCHA', content: { fact: 'uses Clerk' } },
    { id: 'm_uncertain', category: 'GOTCHA', content: { fact: 'maybe slow' } },
  ])
  // Judge confidently flags ONLY the clearly-wrong one; uncertain is omitted.
  judgeMemoryCuration.mockResolvedValue([
    { id: 'm_wrong', reason: 'log shows the tests failed' },
  ])

  await memoryCurationService.curateForTask('task1')

  // Wrong memory soft-invalidated...
  expect(invalidate).toHaveBeenCalledTimes(1)
  expect(invalidate).toHaveBeenCalledWith('m_wrong')
  // ...the good and the uncertain memories are left untouched...
  expect(invalidate).not.toHaveBeenCalledWith('m_ok')
  expect(invalidate).not.toHaveBeenCalledWith('m_uncertain')
  // ...and NOTHING is hard-deleted (invalidate-not-delete).
  expect(hardDelete).not.toHaveBeenCalled()
})

it('does nothing when the judge is uncertain about every memory', async () => {
  findMem.mockResolvedValue([
    { id: 'm1', category: 'GOTCHA', content: { fact: 'a' } },
    { id: 'm2', category: 'GOTCHA', content: { fact: 'b' } },
  ])
  judgeMemoryCuration.mockResolvedValue([]) // all uncertain → omit all

  await memoryCurationService.curateForTask('task1')

  expect(invalidate).not.toHaveBeenCalled()
  expect(hardDelete).not.toHaveBeenCalled()
})

it('explicit sessions curate every memory the session recorded (no task scope)', async () => {
  listForTask.mockResolvedValue([{ id: 'sess1', inferred: false }])
  findMem.mockResolvedValue([])
  await memoryCurationService.curateForTask('task1')
  expect(findMem).toHaveBeenCalledWith('sess1')
})

it('an inferred (unattached) session curates only memories born on this task', async () => {
  listForTask.mockResolvedValue([{ id: 'sessU', inferred: true }])
  const rows = [
    {
      id: 'm_mine',
      category: 'GOTCHA',
      content: { fact: 'tests pass' },
      sourceTaskId: 'task1',
    },
    {
      id: 'm_other',
      category: 'GOTCHA',
      content: { fact: 'other' },
      sourceTaskId: 'task2',
    },
  ]
  findMem.mockImplementation(
    async (_s: string, opts?: { sourceTaskId?: string }) =>
      opts?.sourceTaskId
        ? rows.filter(r => r.sourceTaskId === opts.sourceTaskId)
        : rows
  )
  // Even a judge that flags the other task's memory cannot retire it.
  judgeMemoryCuration.mockImplementation(
    async ({ candidates }: { candidates: { id: string }[] }) =>
      candidates.map(c => ({ id: c.id, reason: 'wrong' }))
  )

  await memoryCurationService.curateForTask('task1')

  expect(findMem).toHaveBeenCalledWith('sessU', { sourceTaskId: 'task1' })
  const judged = judgeMemoryCuration.mock.calls[0][0].candidates.map(
    (c: { id: string }) => c.id
  )
  expect(judged).toEqual(['m_mine'])
  expect(invalidate).toHaveBeenCalledWith('m_mine')
  expect(invalidate).not.toHaveBeenCalledWith('m_other')
})
