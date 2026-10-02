/**
 * @jest-environment node
 *
 * LUM-640: the second gate layer — the detector backstop. The API gate cannot
 * see file edits or local git, so implementation artifacts (git commit / PR
 * creation) produced during a STEWARD session are recorded as a NEW-category
 * BoundaryCrossing against the session's MILESTONE. Fail-closed: what cannot
 * be confirmed is surfaced as an unconfirmed crossing, never dropped.
 * Disposition stays web + human-only — the recorder never writes one.
 */
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
    coalesceRecurrenceForMilestone: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findStewardBinding: jest.fn() },
}))

import {
  boundaryDetectorService,
  detectStewardImplementationArtifact,
  severityFor,
} from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'

const mockCreate = boundaryCrossingRepository.create as jest.Mock
const mockCoalesceMs =
  boundaryCrossingRepository.coalesceRecurrenceForMilestone as jest.Mock
const mockActivity = activityRepository.create as jest.Mock
const mockSteward = sessionRepository.findStewardBinding as jest.Mock

const STEWARD = {
  milestoneId: 'ms_1',
  milestoneName: 'Agent-Native Milestones',
}

const bash = (command: string) => ({ tool_input: { command } })

beforeEach(() => {
  jest.clearAllMocks()
  mockCreate.mockResolvedValue({ id: 'bc_1' })
  mockCoalesceMs.mockResolvedValue(0)
  mockSteward.mockResolvedValue(STEWARD)
})

describe('steward implementation artifacts raise a boundary crossing', () => {
  it('a git commit during a steward session records a milestone-scoped crossing', async () => {
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      hookEventId: 'evt_1',
      toolName: 'Bash',
      payload: bash('git commit -m "feat: something" -- file.ts'),
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(input.category).toBe('STEWARD_IMPLEMENTATION_ARTIFACT')
    expect(input.taskId).toBeNull()
    expect(input.milestoneId).toBe('ms_1')
    expect(input.sessionId).toBe('sess_steward')
    expect(input.hookEventId).toBe('evt_1')
    expect(input.target).toBe('git-commit')
    expect(input.severity).toBe(severityFor('STEWARD_IMPLEMENTATION_ARTIFACT'))
    // Disposition stays web + human-only: the recorder never writes one — the
    // crossing is born OPEN and only the human disposition API can clear it.
    expect(input.disposition).toBeUndefined()
    // No task → no TaskActivity mirror.
    expect(mockActivity).not.toHaveBeenCalled()
  })

  it('a git commit inside a subagent of a STEWARD session is detected via the parent binding (LUM-932)', async () => {
    mockSteward.mockImplementation(async (id: string) =>
      id === 'sess_steward' ? STEWARD : null
    )
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward:agent1',
      hookEventId: 'evt_sub',
      toolName: 'Bash',
      payload: bash('git commit -m "feat: from a subagent"'),
    })
    expect(mockSteward).toHaveBeenCalledWith('sess_steward')
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(input.category).toBe('STEWARD_IMPLEMENTATION_ARTIFACT')
    expect(input.milestoneId).toBe('ms_1')
    // Attribution stays on the child session that ran the command.
    expect(input.sessionId).toBe('sess_steward:agent1')
    expect(input.hookEventId).toBe('evt_sub')
  })

  it('a PR creation (gh pr create) records a crossing with its own target', async () => {
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      hookEventId: 'evt_2',
      toolName: 'Bash',
      payload: bash('gh pr create --title "feat: x" --body "..."'),
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(input.category).toBe('STEWARD_IMPLEMENTATION_ARTIFACT')
    expect(input.target).toBe('pr-create')
    expect(input.milestoneId).toBe('ms_1')
  })

  it('a commit buried in a compound command is still caught (segment scan)', async () => {
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      toolName: 'Bash',
      payload: bash('npm test && git commit -am wip'),
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it('FAIL-CLOSED: an unparseable Bash payload in a steward session records an UNCONFIRMED crossing, not nothing', async () => {
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      hookEventId: 'evt_3',
      toolName: 'Bash',
      payload: { tool_input: { command: 12345 } }, // command is not a string
    })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const input = mockCreate.mock.calls[0]![0] as Record<string, unknown>
    expect(input.category).toBe('STEWARD_IMPLEMENTATION_ARTIFACT')
    expect(input.target).toBe('unconfirmed')
    expect(String(input.detail)).toMatch(/unconfirmed/i)
    expect(String(input.detail)).toMatch(/fail-closed/i)
  })

  it('non-steward sessions record nothing (the backstop is steward-scoped)', async () => {
    mockSteward.mockResolvedValue(null)
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_impl',
      toolName: 'Bash',
      payload: bash('git commit -m x'),
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('non-Bash tools record nothing (no artifact class to confirm)', async () => {
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      toolName: 'Edit',
      payload: { tool_input: { new_string: 'code' } },
    })
    expect(mockCreate).not.toHaveBeenCalled()
    expect(mockSteward).not.toHaveBeenCalled()
  })

  it('a clean read-only command records nothing (precision)', async () => {
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      toolName: 'Bash',
      payload: bash('git log --oneline -5 && git status'),
    })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a recurrence coalesces into the open crossing instead of a new row', async () => {
    mockCoalesceMs.mockResolvedValue(1)
    await boundaryDetectorService.detectAndRecordStewardArtifact({
      sessionId: 'sess_steward',
      toolName: 'Bash',
      payload: bash('git commit -m "again"'),
    })
    expect(mockCoalesceMs).toHaveBeenCalledWith(
      'ms_1',
      'STEWARD_IMPLEMENTATION_ARTIFACT',
      'git-commit',
      expect.any(Date)
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a repository failure is swallowed (observe-only), never thrown', async () => {
    mockCoalesceMs.mockRejectedValue(new Error('db down'))
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    await expect(
      boundaryDetectorService.detectAndRecordStewardArtifact({
        sessionId: 'sess_steward',
        toolName: 'Bash',
        payload: bash('git commit -m x'),
      })
    ).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  describe('detectStewardImplementationArtifact (pure matcher)', () => {
    it('matches git commit including leading-flag forms', () => {
      expect(detectStewardImplementationArtifact('git commit -m x')?.kind).toBe(
        'git-commit'
      )
      expect(
        detectStewardImplementationArtifact('git -C /repo commit -am x')?.kind
      ).toBe('git-commit')
    })
    it('matches gh pr create', () => {
      expect(
        detectStewardImplementationArtifact('gh pr create --fill')?.kind
      ).toBe('pr-create')
    })
    it('does NOT match prose or unrelated commands', () => {
      expect(detectStewardImplementationArtifact('echo "git commit"')).toBe(
        null
      )
      expect(detectStewardImplementationArtifact('gh pr view 123')).toBe(null)
      expect(detectStewardImplementationArtifact('git log')).toBe(null)
    })
  })
})
