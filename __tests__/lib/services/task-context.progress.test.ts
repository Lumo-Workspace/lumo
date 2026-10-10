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
    expect(out).toContain('- Hook the route up')
    expect(out).toContain('- Add the CLI envelope slot')
  })

  it('omits the follow-ups block when there are no unresolved items', async () => {
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
    expect(out).not.toContain('Candidate follow-ups')
    expect(out).not.toContain('\n- ')
  })

  it('returns "" when there is no prior session with a summary', async () => {
    listForTask.mockResolvedValue([])

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toBe('')
  })

  it('appends sub-60-minute active duration as "Xmin active" suffix on the headline', async () => {
    listForTask.mockResolvedValue([
      {
        id: 'sess_prev',
        summaryType: 'implementation',
        summary: { goal: 'Quick fix session', unresolved: [] },
        lastActivityAt: new Date('2026-06-13T10:00:00Z'),
      },
    ])
    // findTurnBoundaryEventsForSessions returns [] by default → durationMs=0,
    // so we need to provide real events to get a non-zero duration.
    // Instead, spy on the internal recovery builder to inject durationMs directly.
    const spy = jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue({
        sessionId: 'sess_prev',
        headline: 'Quick fix session',
        unresolved: [],
        durationMs: 23 * 60_000,
        lastActivityAt: '2026-06-13T10:00:00Z',
      })

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('Quick fix session')
    expect(out).toContain('23min active')
    spy.mockRestore()
  })

  it('appends hours+minutes duration as "Xh Ymin active" when >= 60 minutes', async () => {
    const spy = jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue({
        sessionId: 'sess_prev',
        headline: 'Long refactor session',
        unresolved: [],
        durationMs: 65 * 60_000,
        lastActivityAt: '2026-06-13T10:00:00Z',
      })

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('Long refactor session')
    expect(out).toContain('1h 5min active')
    spy.mockRestore()
  })

  it('omits duration suffix when durationMs is 0', async () => {
    const spy = jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue({
        sessionId: 'sess_prev',
        headline: 'Session with no tracked time',
        unresolved: [],
        durationMs: 0,
        lastActivityAt: '2026-06-13T10:00:00Z',
      })

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('Session with no tracked time')
    expect(out).not.toContain('active')
    spy.mockRestore()
  })

  it('caps unresolved list at 5 and appends "+N more" pointer when there are more than 5', async () => {
    const spy = jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue({
        sessionId: 'sess_prev',
        headline: 'Big session',
        unresolved: [
          'Item one',
          'Item two',
          'Item three',
          'Item four',
          'Item five',
          'Item six',
          'Item seven',
        ],
        durationMs: 0,
        lastActivityAt: '2026-06-13T10:00:00Z',
      })

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('- Item one')
    expect(out).toContain('- Item two')
    expect(out).toContain('- Item three')
    expect(out).toContain('- Item four')
    expect(out).toContain('- Item five')
    // items 6 and 7 must NOT appear as follow-up entries
    expect(out).not.toContain('- Item six')
    expect(out).not.toContain('- Item seven')
    // pointer line: 7 - 5 = 2 more
    expect(out).toContain('- +2 more')
    expect(out).toContain('lumo task context')
    spy.mockRestore()
  })

  it('renders all 5 items without a "+N more" line when there are exactly 5 unresolved', async () => {
    const spy = jest
      .spyOn(taskContextService, 'buildPreviousSessionRecoveryForTask')
      .mockResolvedValue({
        sessionId: 'sess_prev',
        headline: 'Five-item session',
        unresolved: ['A', 'B', 'C', 'D', 'E'],
        durationMs: 0,
        lastActivityAt: '2026-06-13T10:00:00Z',
      })

    const out = await taskContextService.buildProgressSectionForTask(
      'tsk_1',
      'sess_current'
    )

    expect(out).toContain('- A')
    expect(out).toContain('- E')
    expect(out).not.toContain('more')
    spy.mockRestore()
  })
})
