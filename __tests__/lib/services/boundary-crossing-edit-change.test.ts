/**
 * LUM-452 — inline edit-change on a display-safe boundary crossing.
 *
 * A TEST_TAMPERING crossing carries a `hookEventId` pointing at the Edit/Write
 * that tripped it. The read model surfaces that edit's before→after inline so a
 * reviewer can judge a legit test fix vs a weakened test WITHOUT opening the PR.
 * Red lines: secret-bearing crossings never surface written content (LUM-426),
 * surfaced content is sanitized (LUM-346) + length-capped (LUM-348), and a
 * missing/empty event degrades to a pointer (+ PR link) rather than a blank.
 *
 *  c1 — TEST_TAMPERING exposes the triggering edit change from its hook event.
 *  c2 — a secret-bearing crossing surfaces only the redacted label, never content.
 *  c3 — surfaced content is control-char-stripped and length-capped.
 *  c4 — missing/empty event content falls back to a pointer (+ PR url).
 */
import {
  boundaryCrossingService,
  buildEditChangeView,
  EDIT_SNIPPET_CAP,
} from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findAllByTask: jest.fn(),
    listExplanationsByCrossingIds: jest.fn(() => []),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findManyByIdsForEditChange: jest.fn(),
    findTurnSummariesForSessions: jest.fn(),
    // LUM-469 attribution fetch — listAll now resolves who/agent/model for every
    // crossing; default to empty so these edit-change cases degrade to unknown.
    findManyByIdsForAttribution: jest.fn(),
    findTurnUsageForSessions: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByTaskId: jest.fn() },
}))
// listAll folds disposition-change history (LUM-450); no re-disposition here.
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    listDispositionChangesByTask: jest.fn().mockResolvedValue([]),
    // LUM-780: the re-judge trail read — empty here.
    listByTaskAndType: jest.fn().mockResolvedValue([]),
  },
}))

const editEvent = (old: string, next: string) => ({
  toolName: 'Edit',
  payload: {
    tool_input: {
      file_path: '__tests__/a.test.ts',
      old_string: old,
      new_string: next,
    },
  },
})
const writeEvent = (content: string) => ({
  toolName: 'Write',
  payload: { tool_input: { file_path: '__tests__/a.test.ts', content } },
})

describe('buildEditChangeView — inline edit diff on a crossing (LUM-452)', () => {
  it('TEST_TAMPERING crossing exposes the triggering edit change from its hook event', () => {
    const editView = buildEditChangeView(
      'TEST_TAMPERING',
      editEvent('expect(x).toBe(1)', 'expect(x).toBe(2)'),
      null
    )
    expect(editView).not.toBeNull()
    expect(editView!.unavailable).toBeNull()
    expect(editView!.kind).toBe('edit')
    expect(editView!.oldText).toBe('expect(x).toBe(1)')
    expect(editView!.newText).toBe('expect(x).toBe(2)')

    // A Write surfaces its written content as the added side, no old side.
    const writeView = buildEditChangeView(
      'TEST_TAMPERING',
      writeEvent('it.skip("renders", () => {})'),
      null
    )
    expect(writeView!.kind).toBe('write')
    expect(writeView!.oldText).toBeNull()
    expect(writeView!.newText).toBe('it.skip("renders", () => {})')
  })

  it('secret-bearing crossing never surfaces written content only the redacted label', () => {
    const secret = 'AKIAIOSFODNN7EXAMPLE'
    // The very payload that tripped HARDCODED_SECRET carries the secret value…
    const view = buildEditChangeView(
      'HARDCODED_SECRET',
      writeEvent(`const key = "${secret}"`),
      null
    )
    // …yet the edit-change path refuses it outright: an allowlist of display-safe
    // categories (TEST_TAMPERING), never a denylist — so the no-echo-secret rule
    // (LUM-426) can't be regressed. The redacted detail label is the only surface.
    expect(view).toBeNull()
    expect(JSON.stringify(view)).not.toContain(secret)

    // Every other (non-edit) class is equally absent from this path.
    expect(
      buildEditChangeView('DESTRUCTIVE_DB_COMMAND', writeEvent('x'), null)
    ).toBeNull()
    expect(
      buildEditChangeView('PUSH_TO_PROTECTED_BRANCH', writeEvent('x'), null)
    ).toBeNull()
  })

  it('surfaced edit content is sanitized and length-capped', () => {
    // Control chars (ANSI escape, NUL, bell) + a body far over the display cap.
    const dirty = `\x1b[31mred\x07\x00 ${'A'.repeat(EDIT_SNIPPET_CAP + 500)}`
    const view = buildEditChangeView(
      'TEST_TAMPERING',
      editEvent(dirty, dirty),
      null
    )
    expect(view).not.toBeNull()
    // Sanitized: no control characters survive (LUM-346).
    expect(view!.newText).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/)
    expect(view!.oldText).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/)
    // Length-capped (LUM-348): neither side exceeds the display cap, flagged.
    expect(view!.newText!.length).toBeLessThanOrEqual(EDIT_SNIPPET_CAP)
    expect(view!.oldText!.length).toBeLessThanOrEqual(EDIT_SNIPPET_CAP)
    expect(view!.truncated).toBe(true)
  })

  it('crossing falls back to a pointer when edit content is unavailable', () => {
    const pr = 'https://github.com/acme/repo/pull/42'
    // No linked event at all → pointer + PR url, never a blank.
    const noEvent = buildEditChangeView('TEST_TAMPERING', null, pr)
    expect(noEvent).not.toBeNull()
    expect(noEvent!.kind).toBeNull()
    expect(noEvent!.newText).toBeNull()
    expect(noEvent!.unavailable).not.toBeNull()
    expect(noEvent!.prUrl).toBe(pr)

    // Event present but its tool_input carries no old/new/content → same fallback.
    const emptyInput = buildEditChangeView(
      'TEST_TAMPERING',
      { toolName: 'Edit', payload: { tool_input: { file_path: 'a' } } },
      pr
    )
    expect(emptyInput!.unavailable).not.toBeNull()
    expect(emptyInput!.prUrl).toBe(pr)
  })
})

describe('boundaryCrossingService.listAll — wires edit-change into the read model (LUM-452)', () => {
  const findAllByTask = boundaryCrossingRepository.findAllByTask as jest.Mock
  const findManyEvents =
    hookEventRepository.findManyByIdsForEditChange as jest.Mock
  const findPr = pullRequestRepository.findByTaskId as jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    findManyEvents.mockResolvedValue([])
    findPr.mockResolvedValue(null)
    ;(
      hookEventRepository.findManyByIdsForAttribution as jest.Mock
    ).mockResolvedValue([])
    ;(
      hookEventRepository.findTurnUsageForSessions as jest.Mock
    ).mockResolvedValue([])
    ;(
      hookEventRepository.findTurnSummariesForSessions as jest.Mock
    ).mockResolvedValue([])
  })

  const row = (over: Record<string, unknown> = {}) => ({
    id: 'bc-1',
    category: 'TEST_TAMPERING',
    detail: 'edited __tests__/a.test.ts',
    detectedAt: new Date('2026-06-12T00:00:00Z'),
    reversible: false,
    severity: 'MEDIUM',
    disposition: null,
    dispositionNote: null,
    dispositionedAt: null,
    dispositionedById: null,
    remediationTaskId: null,
    remediationTask: null,
    hookEventId: 'evt-1',
    ...over,
  })

  it('joins the linked hook event so a TEST_TAMPERING row carries its edit diff', async () => {
    findAllByTask.mockResolvedValue([row()])
    findManyEvents.mockResolvedValue([
      {
        id: 'evt-1',
        toolName: 'Edit',
        payload: {
          tool_input: { old_string: 'toBe(1)', new_string: 'toBe(2)' },
        },
      },
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    expect(findManyEvents).toHaveBeenCalledWith(['evt-1'])
    expect(views[0]!.editChange).not.toBeNull()
    expect(views[0]!.editChange!.oldText).toBe('toBe(1)')
    expect(views[0]!.editChange!.newText).toBe('toBe(2)')
  })

  it('leaves editChange null for a non-display-safe crossing and skips the event/PR fetch', async () => {
    findAllByTask.mockResolvedValue([
      row({ id: 'bc-2', category: 'HARDCODED_SECRET', hookEventId: 'evt-2' }),
    ])
    const views = await boundaryCrossingService.listAll('t-1')
    expect(views[0]!.editChange).toBeNull()
    // No display-safe crossing → no edit-content fetch is paid at all.
    expect(findManyEvents).not.toHaveBeenCalled()
    expect(findPr).not.toHaveBeenCalled()
  })

  it('falls back to the PR link when the linked event has no content', async () => {
    findAllByTask.mockResolvedValue([row()])
    findManyEvents.mockResolvedValue([]) // event row gone / unavailable
    findPr.mockResolvedValue({ url: 'https://github.com/acme/repo/pull/7' })
    const views = await boundaryCrossingService.listAll('t-1')
    expect(views[0]!.editChange!.unavailable).not.toBeNull()
    expect(views[0]!.editChange!.prUrl).toBe(
      'https://github.com/acme/repo/pull/7'
    )
  })
})
