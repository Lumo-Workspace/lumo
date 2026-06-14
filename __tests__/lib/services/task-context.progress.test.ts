/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findTurnBoundaryEventsForSessions: jest.fn().mockResolvedValue([]),
  },
}))
// task-context.service → task.service fans out a wide import graph (incl. the
// GitHub integration); stub the unrelated modules so it loads side-effect-free.
jest.mock('@/lib/services/task-pr-sync.service', () => ({
  syncPullRequestStatus: jest.fn(),
}))
jest.mock('@/lib/services/task-notifications.service', () => ({
  dispatchCreateTaskSideEffects: jest.fn(),
}))
jest.mock('@/lib/services/document.service', () => ({
  scheduleDocumentSummary: jest.fn(),
}))

import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'

const listForTask = sessionRepository.listForTask as jest.Mock

describe('taskContextService.buildProgressSectionForTask (LUM-500 Tier-1)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders a full ## Progress block from the prior session recovery', async () => {
    listForTask.mockResolvedValue([
      {
        id: 'sess_prev',
        summaryType: 'implementation',
        summary: {
          goal: 'Wire the progressive-disclosure refactor',
          unresolved: ['Hook the route up', 'Add the CLI envelope slot'],
        },
        lastActivityAt: new Date('2026-06-13T10:00:00Z'),
      },
    ])

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('## Progress')
    expect(out).toContain('Wire the progressive-disclosure refactor')
    expect(out).toContain('- [ ] Hook the route up')
    expect(out).toContain('- [ ] Add the CLI envelope slot')
  })

  it('omits the Unresolved block when there are no unresolved items', async () => {
    listForTask.mockResolvedValue([
      {
        id: 'sess_prev',
        summaryType: 'implementation',
        summary: { goal: 'Did the thing', unresolved: [] },
        lastActivityAt: new Date('2026-06-13T10:00:00Z'),
      },
    ])

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('## Progress')
    expect(out).toContain('Did the thing')
    expect(out).not.toContain('Unresolved')
    expect(out).not.toContain('- [ ]')
  })

  it('returns "" when there is no prior session with a summary', async () => {
    listForTask.mockResolvedValue([])

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toBe('')
  })
})
