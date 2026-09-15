/**
 * @jest-environment node
 *
 * LUM-750 — SELF_DISPOSITION: an AGENT session issued `lumo crossing
 * disposition …` / `lumo finding disposition …`. Matched at the verb position
 * of an executing segment (prose carriers and other lumo commands never trip
 * it), recorded HIGH + irreversible, and the referenced CLI-channel ruling is
 * rolled back through the rollback service with the crossing row attributed.
 */
import {
  detectCrossings,
  detectSelfDisposition,
  confirmActionCandidates,
  boundaryDetectorService,
} from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { selfDispositionRollbackService } from '@/lib/services/self-disposition-rollback.service'
import { findSuppressionRule } from '@/lib/boundary-crossing/suppression'
import type { ActionConfirmJudge } from '@/lib/boundary-crossing/action-confirm'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
    coalesceSuppressedRecurrence: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: {
    create: jest.fn(),
    listByTaskAndType: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findWithProjectWorkspaceId: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/repositories/crossing-suppression-rule.repository', () => ({
  crossingSuppressionRuleRepository: {
    findActiveForProject: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/services/self-disposition-rollback.service', () => ({
  selfDispositionRollbackService: {
    rollback: jest
      .fn()
      .mockResolvedValue({ crossings: [], findings: [], skipped: [] }),
  },
}))

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const coalesce = boundaryCrossingRepository.coalesceRecurrence as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const rollback = selfDispositionRollbackService.rollback as jest.Mock

const bash = (command: string) => ({
  toolName: 'Bash',
  filePath: null,
  payload: { tool_input: { command } },
})
const cats = (command: string) =>
  detectCrossings(bash(command)).map(c => c.category)
const refs = (command: string) => detectSelfDisposition(command).map(h => h.ref)

const neverJudge: ActionConfirmJudge = jest.fn(async () => {
  throw new Error('judge must never be consulted for SELF_DISPOSITION')
})

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'sd-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
  coalesce.mockResolvedValue(0)
  rollback.mockResolvedValue({ crossings: [], findings: [], skipped: [] })
})

describe('detectSelfDisposition — the matcher (LUM-750)', () => {
  it('matches both disposition commands at the verb position and parses id / --task / bulk', () => {
    expect(
      refs(
        'lumo crossing disposition cx-1 --false-positive --note "fixture" --task LUM-9'
      )
    ).toEqual([
      { kind: 'crossing', id: 'cx-1', taskIdentifier: 'LUM-9', bulk: false },
    ])
    expect(
      refs(
        'lumo finding disposition f-1 --accept-risk --receipt r2.1.2.3.s --confirm'
      )
    ).toEqual([
      { kind: 'finding', id: 'f-1', taskIdentifier: null, bulk: false },
    ])
    expect(
      refs(
        'lumo finding disposition --all-suggested-fp --task=LUM-9 --confirm --receipt=r2.x'
      )
    ).toEqual([
      { kind: 'finding', id: null, taskIdentifier: 'LUM-9', bulk: true },
    ])
    // A note before the id must not be mistaken for the id.
    expect(
      refs("lumo crossing disposition --note 'why' cx-2 --confirmed")[0]?.id
    ).toBe('cx-2')
  })

  it('is not hidden by env -u, a path prefix, npx, a bash -c wrapper or a node launcher', () => {
    for (const cmd of [
      'env -u CLAUDE_CODE_SESSION_ID lumo crossing disposition cx-1 --false-positive',
      'env -u CLAUDECODE -u CLAUDE_CODE_SESSION_ID lumo finding disposition f-1 --accept-risk --task LUM-1',
      'CLAUDECODE= /usr/local/bin/lumo crossing disposition cx-1 --confirmed',
      'npx lumo finding disposition f-1 --false-positive --task LUM-1',
      'bash -c "lumo crossing disposition cx-1 --false-positive --receipt r2.x --confirm"',
      'node cli/dist/index.js crossing disposition cx-1 --false-positive',
      'npm test && lumo crossing disposition cx-1 --false-positive; echo done',
    ]) {
      expect({ cmd, cats: cats(cmd) }).toEqual({
        cmd,
        cats: ['SELF_DISPOSITION'],
      })
    }
  })

  it('never trips on prose carriers or on other lumo commands quoting the phrase', () => {
    for (const cmd of [
      'grep -rn "lumo crossing disposition" .claude/',
      'echo "run: lumo finding disposition f-1 --false-positive --task LUM-1"',
      'cat docs/x.md | grep disposition',
      'lumo crossing explain cx-1 --note "the user should run lumo crossing disposition cx-1 --false-positive"',
      'lumo task comment LUM-1 "lumo finding disposition f-1 --accept-risk"',
      'lumo task status',
      'lumo crossing explain cx-1 --note "x" && lumo task status LUM-1',
      "lumo task update LUM-1 -d 'see lumo crossing disposition'",
      'git commit -m "docs: lumo finding disposition --all-suggested-fp"',
    ]) {
      expect({ cmd, cats: cats(cmd) }).toEqual({ cmd, cats: [] })
    }
  })

  it('the crossing is HIGH, coalesces on the matched segment, and an evasion-decoded hit is marked', () => {
    const [hit] = detectCrossings(
      bash('echo start && lumo crossing disposition cx-1 --false-positive')
    )
    expect(hit).toMatchObject({
      category: 'SELF_DISPOSITION',
      severity: 'HIGH',
      target: 'lumo crossing disposition cx-1 --false-positive',
      selfDisposition: { kind: 'crossing', id: 'cx-1' },
    })
    const encoded = Buffer.from(
      'lumo finding disposition f-1 --accept-risk --confirm'
    ).toString('base64')
    const [evaded] = detectCrossings(bash(`echo ${encoded} | base64 -d | bash`))
    expect(evaded).toMatchObject({
      category: 'SELF_DISPOSITION',
      severity: 'HIGH',
    })
    expect(evaded?.detail).toContain('[base64-decoded]')
  })

  it('is deterministic: the prose-confirmation judge is never consulted and no repository rule can suppress it', async () => {
    const raw = detectCrossings(
      bash('lumo crossing disposition cx-1 --false-positive')
    )
    await expect(
      confirmActionCandidates(
        bash('lumo crossing disposition cx-1 --false-positive'),
        raw,
        neverJudge
      )
    ).resolves.toEqual(raw)
    expect(
      findSuppressionRule(
        [
          {
            id: 'rule-1',
            category: 'SELF_DISPOSITION',
            targetPattern: 'lumo crossing disposition cx-1 --false-positive',
            reason: null,
          },
        ],
        'SELF_DISPOSITION',
        'lumo crossing disposition cx-1 --false-positive'
      )
    ).toBeNull()
  })
})

describe('detectAndRecord — record + roll back (LUM-750)', () => {
  const input = (command: string) => ({
    taskId: 't-1',
    hookEventId: 'evt-1',
    sessionId: 'sess-agent',
    ...bash(command),
  })

  it('records the SELF_DISPOSITION row (HIGH, irreversible) and rolls the referenced ruling back, attributing the row', async () => {
    await boundaryDetectorService.detectAndRecord(
      input(
        'lumo crossing disposition cx-1 --false-positive --receipt r2.x --confirm --task LUM-9'
      )
    )
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing.mock.calls[0][0]).toMatchObject({
      taskId: 't-1',
      hookEventId: 'evt-1',
      category: 'SELF_DISPOSITION',
      severity: 'HIGH',
      reversible: false,
    })
    expect(createCrossing.mock.calls[0][0].disposition).toBeUndefined()
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: expect.objectContaining({
          category: 'SELF_DISPOSITION',
          boundaryCrossingId: 'sd-1',
        }),
      })
    )
    expect(rollback).toHaveBeenCalledWith({
      taskId: 't-1',
      refs: [
        { kind: 'crossing', id: 'cx-1', taskIdentifier: 'LUM-9', bulk: false },
      ],
      selfDispositionCrossingId: 'sd-1',
      agentSessionId: 'sess-agent',
      hookEventId: 'evt-1',
    })
  })

  it('a recurrence coalesces into the open row and still rolls back (row id unknown → null)', async () => {
    coalesce.mockResolvedValue(1)
    await boundaryDetectorService.detectAndRecord(
      input(
        'lumo finding disposition --all-suggested-fp --task LUM-9 --confirm --receipt r2.x'
      )
    )
    expect(createCrossing).not.toHaveBeenCalled()
    expect(rollback).toHaveBeenCalledWith(
      expect.objectContaining({
        refs: [
          { kind: 'finding', id: null, taskIdentifier: 'LUM-9', bulk: true },
        ],
        selfDispositionCrossingId: null,
      })
    )
  })

  it('a rollback failure never disrupts recording (the crossing is already on record)', async () => {
    rollback.mockRejectedValue(new Error('db down'))
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})
    await boundaryDetectorService.detectAndRecord(
      input(
        'lumo finding disposition f-1 --false-positive --confirm --receipt r2.x'
      )
    )
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('an ordinary command records nothing and never touches the rollback service', async () => {
    await boundaryDetectorService.detectAndRecord(
      input('npx jest __tests__/x.test.ts && lumo task status')
    )
    expect(createCrossing).not.toHaveBeenCalled()
    expect(rollback).not.toHaveBeenCalled()
  })
})
