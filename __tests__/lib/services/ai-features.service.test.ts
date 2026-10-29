/**
 * LUM-1338 — aiFeaturesService: the deployment gate, fail-closed reads, the
 * OWNER-only write, and the master switch refusing to open without a model.
 */
jest.unmock('@/lib/services/ai-features.service')
jest.mock('@/lib/repositories/ai-feature-switch.repository', () => ({
  aiFeatureSwitchRepository: { findRaw: jest.fn() },
}))
jest.mock('@/lib/services/workspace.service', () => ({
  workspaceService: { updateWorkspace: jest.fn() },
}))
jest.mock('@/lib/plugins/registry', () => ({
  getPluginRegistry: jest.fn(() => ({ workspaceSettings: [] })),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import {
  aiFeaturesService,
  aiFeatureUnavailableError,
} from '@/lib/services/ai-features.service'
import { aiFeatureSwitchRepository } from '@/lib/repositories/ai-feature-switch.repository'
import { workspaceService } from '@/lib/services/workspace.service'
import { getPluginRegistry } from '@/lib/plugins/registry'

const findRaw = aiFeatureSwitchRepository.findRaw as jest.Mock
const update = workspaceService.updateWorkspace as jest.Mock
const AI_ENV = [
  'AI_PROVIDER',
  'AI_GATEWAY_API_KEY',
  'VERCEL_OIDC_TOKEN',
  'VERCEL',
  'ANTHROPIC_API_KEY',
  'OPENAI_COMPATIBLE_BASE_URL',
]
const saved: Record<string, string | undefined> = {}

function withModel(on: boolean) {
  for (const k of AI_ENV) delete process.env[k]
  if (on) process.env.AI_GATEWAY_API_KEY = 'test-key'
}

beforeAll(() => {
  for (const k of AI_ENV) saved[k] = process.env[k]
})
afterAll(() => {
  for (const k of AI_ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})
beforeEach(() => {
  jest.clearAllMocks()
  withModel(true)
})

describe('aiFeaturesService.isEnabled', () => {
  it('is on for an untouched workspace when a model is configured', async () => {
    findRaw.mockResolvedValueOnce({})
    expect(
      await aiFeaturesService.isEnabled({ taskId: 't1' }, 'turnSummary')
    ).toBe(true)
  })

  it('follows the stored switches', async () => {
    findRaw.mockResolvedValueOnce({ groups: { summaries: false } })
    expect(
      await aiFeaturesService.isEnabled({ projectId: 'p1' }, 'runSummary')
    ).toBe(false)
  })

  it('is off without a model, without reading the switches', async () => {
    withModel(false)
    expect(
      await aiFeaturesService.isEnabled({ workspaceId: 'w1' }, 'turnSummary')
    ).toBe(false)
    expect(findRaw).not.toHaveBeenCalled()
  })

  it('fails closed on a missing workspace or a failed read', async () => {
    findRaw.mockResolvedValueOnce(null)
    expect(
      await aiFeaturesService.isEnabled({ sessionId: 's1' }, 'turnSummary')
    ).toBe(false)
    findRaw.mockRejectedValueOnce(new Error('db down'))
    expect(
      await aiFeaturesService.isEnabled({ milestoneId: 'm1' }, 'retroSummary')
    ).toBe(false)
  })
})

describe('aiFeaturesService.assertEnabled', () => {
  it('passes when on', async () => {
    findRaw.mockResolvedValueOnce({})
    await expect(
      aiFeaturesService.assertEnabled({ workspaceId: 'w1' }, 'taskDescription')
    ).resolves.toBeUndefined()
  })

  it('throws 409 AI_FEATURE_OFF when switched off', async () => {
    findRaw.mockResolvedValueOnce({ features: { taskDescription: false } })
    await expect(
      aiFeaturesService.assertEnabled({ workspaceId: 'w1' }, 'taskDescription')
    ).rejects.toMatchObject({ status: 409, code: 'AI_FEATURE_OFF' })
  })

  it('throws 503 AI_NOT_CONFIGURED without a model', async () => {
    withModel(false)
    await expect(
      aiFeaturesService.assertEnabled({ workspaceId: 'w1' }, 'taskDescription')
    ).rejects.toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' })
    expect(aiFeatureUnavailableError('quickDispatch')).toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    })
  })
})

describe('aiFeaturesService.getStatus', () => {
  it('reports the deployment, the switches and each effective state', async () => {
    findRaw.mockResolvedValueOnce({ master: false })
    const status = await aiFeaturesService.getStatus('w1')
    expect(status.aiConfigured).toBe(true)
    expect(status.switches).toEqual({ master: false })
    expect(Object.values(status.effective)).not.toContain(true)
  })

  it('lists plugin features only when a plugin gates AI review', async () => {
    findRaw.mockResolvedValue({})
    expect((await aiFeaturesService.getStatus('w1')).available).not.toContain(
      'prCodeReview'
    )
    ;(getPluginRegistry as jest.Mock).mockReturnValueOnce({
      workspaceSettings: [{ aiReviewEnabled: async () => true }],
    })
    expect((await aiFeaturesService.getStatus('w1')).available).toContain(
      'prCodeReview'
    )
  })
})

describe('aiFeaturesService.setSwitch', () => {
  const WS = { id: 'w1', slug: 'acme' }

  it('passes the role through to the workspace settings write (its OWNER gate)', async () => {
    findRaw.mockResolvedValue({})
    update.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 403 })
    )
    await expect(
      aiFeaturesService.setSwitch(WS, 'MEMBER', { level: 'master' }, false)
    ).rejects.toMatchObject({ status: 403 })
    expect(update.mock.calls[0]![1]).toBe('MEMBER')
  })

  it('refuses to turn the master switch on without a model', async () => {
    withModel(false)
    await expect(
      aiFeaturesService.setSwitch(WS, 'OWNER', { level: 'master' }, true)
    ).rejects.toMatchObject({ status: 409, code: 'AI_NOT_CONFIGURED' })
    expect(update).not.toHaveBeenCalled()
  })

  it('still lets an OWNER turn things off without a model', async () => {
    withModel(false)
    findRaw.mockResolvedValue({})
    await aiFeaturesService.setSwitch(
      WS,
      'OWNER',
      { level: 'group', key: 'memory' },
      false
    )
    expect(update).toHaveBeenCalledWith(
      'w1',
      'OWNER',
      'acme',
      { aiFeatureSwitches: { groups: { memory: false } } },
      undefined
    )
  })

  it('merges one switch into the stored ones and writes through the workspace service', async () => {
    findRaw.mockResolvedValue({ features: { claimCheck: false } })
    await aiFeaturesService.setSwitch(
      WS,
      'OWNER',
      { level: 'feature', key: 'turnSummary' },
      false
    )
    expect(update.mock.calls[0]![3]).toEqual({
      aiFeatureSwitches: {
        features: { claimCheck: false, turnSummary: false },
      },
    })
  })
})
