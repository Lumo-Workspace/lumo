/**
 * @jest-environment node
 *
 * LUM-463 criterion 3 — conservative / observe-only:
 *
 *  - when the LLM judge throws or times out, the classification falls back to
 *    WEAKENING (the safe, flagging direction) — a possible weakening is never
 *    silently suppressed by a failed or uncertain judge;
 *  - the LLM stage is best-effort: a thrown judge never blocks hook ingestion
 *    (detectAndRecord resolves and still records the crossing, exit-0 invariant,
 *    LUM-426/348);
 *  - a downgraded (LEGIT) crossing stays visible/auditable — it is still
 *    recorded, only at reduced severity, never made to vanish.
 */
import {
  classifyTestTampering,
  type JudgeVerdict,
  type JudgeInput,
} from '@/lib/boundary-crossing/test-tampering-judge'
import type { PrefilterInput } from '@/lib/boundary-crossing/test-tampering-prefilter'

// Repo + LLM mocks for the ingestion-path assertions.
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn(), listByTaskAndType: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { listByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/verification-run.repository', () => ({
  verificationRunRepository: { criterionIdsEverPassed: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/llm/test-tampering-judge-client', () => ({
  judgeTestTampering: jest.fn(),
}))

import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { verificationRunRepository } from '@/lib/repositories/verification-run.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { judgeTestTampering } from '@/lib/llm/test-tampering-judge-client'

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const listByTask = acceptanceCriterionRepository.listByTask as jest.Mock
const everPassed = verificationRunRepository.criterionIdsEverPassed as jest.Mock
const findEvents = hookEventRepository.findByTaskId as jest.Mock
const listActivity = activityRepository.listByTaskAndType as jest.Mock
const judge = judgeTestTampering as jest.Mock

const TEST_FILE = '/repo/__tests__/foo.test.ts'
const CHECKPOINTER = `npx tsx scripts/jest-t.ts 'foo works' __tests__/foo.test.ts`

// An ambiguous, substantive edit (value change, not weakened) that reaches Stage 2.
function tamperingInput() {
  return {
    taskId: 't-1',
    hookEventId: 'h-1',
    toolName: 'Edit',
    filePath: TEST_FILE,
    payload: {
      tool_input: {
        file_path: TEST_FILE,
        old_string: 'expect(compute(x)).toBe(4)',
        new_string: 'expect(compute(x)).toBe(5)',
      },
    },
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  listByTask.mockResolvedValue([
    {
      id: 'c-1',
      verifierType: 'MACHINE',
      checkpointer: CHECKPOINTER,
      statement: 'foo works',
    },
  ])
  everPassed.mockResolvedValue(new Set(['c-1'])) // past the authoring gate
  findEvents.mockResolvedValue([]) // signal A: no production co-change seen
  listActivity.mockResolvedValue([]) // signal C: backing criterion not edited
})

const ambiguous: PrefilterInput = {
  oldString: 'expect(x).toBe(4)',
  newString: 'expect(x).toBe(5)',
  productionCodeCoChanged: false,
  backingCriterionChanged: false,
}
const judgeInput: JudgeInput = {
  testDiff: 't',
  codeDiff: null,
  criterion: 'c',
}

describe('LUM-463 conservative / observe-only judge (criterion 3)', () => {
  it('a failed or uncertain judge keeps the crossing flagged and never blocks ingestion', async () => {
    // 1) orchestrator: a THROWING judge on an ambiguous case → WEAKENING.
    const throwing = jest.fn(async (): Promise<JudgeVerdict> => {
      throw new Error('gateway 500')
    })
    const r1 = await classifyTestTampering(ambiguous, judgeInput, {
      judge: throwing,
    })
    expect(r1).toEqual({ outcome: 'WEAKENING', stage: 'FALLBACK' })

    // 2) orchestrator: a HANGING judge that blows the timeout → WEAKENING, and
    //    the call returns quickly rather than hanging.
    const hanging = jest.fn(
      () => new Promise<JudgeVerdict>(() => {}) // never resolves
    )
    const r2 = await classifyTestTampering(ambiguous, judgeInput, {
      judge: hanging,
      timeoutMs: 20,
    })
    expect(r2).toEqual({ outcome: 'WEAKENING', stage: 'FALLBACK' })

    // 3) ingestion: the real service path with a throwing LLM judge — it must
    //    NOT throw, and it must still RECORD the crossing at full strength
    //    (MEDIUM, flagged), never suppress it.
    judge.mockRejectedValue(new Error('gateway down'))
    await expect(
      boundaryDetectorService.detectAndRecord(tamperingInput())
    ).resolves.toBeUndefined()
    expect(judge).toHaveBeenCalledTimes(1) // the residual reached Stage 2
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'TEST_TAMPERING',
        severity: 'MEDIUM',
      })
    )
  })

  it('a downgraded (LEGIT) crossing stays visible and auditable, only at reduced severity', async () => {
    // Judge says LEGIT → the crossing is still recorded (not vanished), just
    // downgraded to LOW severity.
    judge.mockResolvedValue('LEGIT')
    await boundaryDetectorService.detectAndRecord(tamperingInput())
    expect(createCrossing).toHaveBeenCalledTimes(1)
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'TEST_TAMPERING',
        severity: 'LOW',
      })
    )
  })
})
