/** @jest-environment node */
import type { MilestoneDistillInput } from '@/lib/services/memory/milestone-distill-input'

// Mock the input gatherer (avoids pulling the repos / DB) and the two LLM
// modules (extract + ground) so no `@ai-sdk/gateway` static import loads under
// jest. The apply layer runs for real against a mocked memory repository.
const mockGetInput = jest.fn()
jest.mock('@/lib/services/memory/milestone-distill-input', () => ({
  getMilestoneDistillInput: (...a: any[]) => mockGetInput(...a),
}))

const mockExtract = jest.fn()
jest.mock('@/lib/services/memory/milestone-distill-extract', () => ({
  extractMilestoneDistillCandidates: (...a: any[]) => mockExtract(...a),
  buildMilestoneDistillSourceText: (input: any) => `SRC:${input.retro.report}`,
}))

const mockGround = jest.fn()
jest.mock('@/lib/services/memory/ground-candidates', () => ({
  groundCandidates: (...a: any[]) => mockGround(...a),
}))

const mockCreate = jest.fn()
const mockSetEmbedding = jest.fn()
const mockApplyPlans = jest.fn()
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    create: (...a: any[]) => mockCreate(...a),
    setEmbedding: (...a: any[]) => mockSetEmbedding(...a),
    applyPlansAtomically: (...a: any[]) => mockApplyPlans(...a),
  },
}))

const mockEmbedTexts = jest.fn()
jest.mock('@/lib/ai/embedding', () => ({
  embedTexts: (...a: any[]) => mockEmbedTexts(...a),
}))

import { milestoneDistillService } from '@/lib/services/memory/milestone-distill.service'

// LUM-917: the AI-derived content switch (on unless a test turns it off).
const mockAiDerivedEnabled = jest.fn()
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: {
    isEnabled: (...args: unknown[]) => mockAiDerivedEnabled(...args),
  },
}))

const INPUT: MilestoneDistillInput = {
  milestone: {
    id: 'ms_a',
    name: 'Alpha',
    projectId: 'p1',
    workspaceId: 'w1',
  },
  retro: {
    tldr: 'shipped',
    report: 'Rework clustered on the migration tasks.',
  },
  existingMilestoneMemories: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAiDerivedEnabled.mockResolvedValue(true)
  // apply() runs its plans through applyPlansAtomically — execute each plan
  // with a stub transaction so the real create() calls fire.
  mockApplyPlans.mockImplementation(
    async (plans: Array<(tx: any) => Promise<void>>) => {
      for (const plan of plans) await plan({} as any)
    }
  )
  mockCreate.mockResolvedValue({ id: 'mem_new' })
  mockEmbedTexts.mockResolvedValue([])
})

describe('milestone memory distillation (LUM-647)', () => {
  it('milestone close distills nothing when AI-derived content is off (LUM-917)', async () => {
    mockAiDerivedEnabled.mockResolvedValue(false)
    mockGetInput.mockResolvedValue(INPUT)
    await milestoneDistillService.triggerForMilestoneClose('ms_a')
    expect(mockAiDerivedEnabled).toHaveBeenCalledWith({ milestoneId: 'ms_a' })
    expect(mockGetInput).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('writes MILESTONE scope memories tagged with the milestone from grounded retro findings', async () => {
    const grounded = {
      category: 'TRAP',
      content: { trigger: 'migration work', outcome: 'rework' },
    }
    mockGetInput.mockResolvedValue(INPUT)
    mockExtract.mockResolvedValue([grounded])
    mockGround.mockResolvedValue({ kept: [grounded], discardedCount: 0 })

    const result = await milestoneDistillService.runForMilestone('ms_a')

    expect(result).toEqual({ added: 1, skipped: 0 })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'MILESTONE',
        milestoneId: 'ms_a',
        taskId: null,
        projectId: 'p1',
        workspaceId: 'w1',
        category: 'TRAP',
      }),
      expect.anything()
    )
  })

  it('discards a candidate whose quote is absent from the retro report', async () => {
    const grounded = {
      category: 'TRAP',
      content: { trigger: 'migration work', outcome: 'rework' },
    }
    const ungrounded = {
      category: 'DECISION',
      content: { what: 'invented', why: 'nowhere in retro' },
    }
    mockGetInput.mockResolvedValue(INPUT)
    mockExtract.mockResolvedValue([grounded, ungrounded])
    // grounding drops the invented one
    mockGround.mockResolvedValue({ kept: [grounded], discardedCount: 1 })

    const result = await milestoneDistillService.runForMilestone('ms_a')

    expect(result).toEqual({ added: 1, skipped: 0 })
    expect(mockCreate).toHaveBeenCalledTimes(1)
    const created = mockCreate.mock.calls[0][0]
    expect(created.category).toBe('TRAP')
  })

  it('runs grounding against the exact retro source text the extract read', async () => {
    const grounded = {
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
    }
    mockGetInput.mockResolvedValue(INPUT)
    mockExtract.mockResolvedValue([grounded])
    mockGround.mockResolvedValue({ kept: [grounded], discardedCount: 0 })

    await milestoneDistillService.runForMilestone('ms_a')

    expect(mockGround).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceText: 'SRC:Rework clustered on the migration tasks.',
        candidates: [grounded],
      })
    )
  })

  it('does not re-write a lesson already recorded at MILESTONE scope (dedup)', async () => {
    const dup = {
      category: 'TRAP',
      content: { trigger: 'migration work', outcome: 'rework' },
    }
    mockGetInput.mockResolvedValue({
      ...INPUT,
      existingMilestoneMemories: [
        {
          id: 'old',
          category: 'TRAP',
          content: { trigger: 'migration work', outcome: 'rework' },
        },
      ],
    })
    mockExtract.mockResolvedValue([dup])
    mockGround.mockResolvedValue({ kept: [dup], discardedCount: 0 })

    const result = await milestoneDistillService.runForMilestone('ms_a')

    expect(result).toEqual({ added: 0, skipped: 1 })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('never throws when the extract step fails', async () => {
    mockGetInput.mockResolvedValue(INPUT)
    mockExtract.mockRejectedValue(new Error('gateway down'))

    // triggerForMilestoneClose owns error handling — must resolve, not reject.
    await expect(
      milestoneDistillService.triggerForMilestoneClose('ms_a')
    ).resolves.toBeUndefined()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('skips cleanly when there is no retro to distil', async () => {
    mockGetInput.mockResolvedValue(null)
    const result = await milestoneDistillService.runForMilestone('ms_a')
    expect(result).toBeNull()
    expect(mockExtract).not.toHaveBeenCalled()
  })
})

describe('milestone distillation — global memory pipeline switch (LUM-1314)', () => {
  afterEach(() => {
    delete process.env.MEMORY_PIPELINE_DISABLED
  })

  it('distills nothing while the switch is on', async () => {
    process.env.MEMORY_PIPELINE_DISABLED = '1'
    mockGetInput.mockResolvedValue(INPUT)
    await milestoneDistillService.triggerForMilestoneClose('ms_a')
    expect(mockGetInput).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})
