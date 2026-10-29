/**
 * @jest-environment node
 *
 * LUM-1338 — GET / PATCH /api/workspaces/me/ai-features with the real route,
 * zod schema and services; only auth, the plugin registry and the
 * repositories are mocked.
 */
import { NextRequest } from 'next/server'

jest.unmock('@/lib/services/ai-features.service')
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({
  requireUserWorkspace: jest.fn(),
  zodError: (parsed: { error: { issues: { message: string }[] } }) => {
    const { NextResponse } = require('next/server')
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    update: jest.fn(),
    isSlugUnique: jest.fn(),
    findAuditedSettings: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/ai-feature-switch.repository', () => ({
  aiFeatureSwitchRepository: { findRaw: jest.fn() },
}))
jest.mock('@/lib/plugins/registry', () => ({
  getPluginRegistry: jest.fn(() => ({ workspaceSettings: [] })),
}))
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: jest.fn(),
}))
jest.mock('@/lib/services', () => ({
  aiFeaturesService: jest.requireActual('@/lib/services/ai-features.service')
    .aiFeaturesService,
}))

import { GET, PATCH } from '@/app/api/workspaces/me/ai-features/route'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { aiFeatureSwitchRepository } from '@/lib/repositories/ai-feature-switch.repository'

const update = workspaceRepository.update as jest.Mock
const findRaw = aiFeatureSwitchRepository.findRaw as jest.Mock
const savedKey = process.env.AI_GATEWAY_API_KEY
const savedProvider = process.env.AI_PROVIDER

function asRole(role: 'OWNER' | 'MEMBER') {
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    workspace: { id: 'w1', slug: 'acme', name: 'Acme' },
    member: { id: 'm1', role },
  })
}

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/workspaces/me/ai-features', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.AI_PROVIDER
  process.env.AI_GATEWAY_API_KEY = 'test-key'
  findRaw.mockResolvedValue({})
  update.mockResolvedValue({ id: 'w1' })
})
afterAll(() => {
  if (savedKey === undefined) delete process.env.AI_GATEWAY_API_KEY
  else process.env.AI_GATEWAY_API_KEY = savedKey
  if (savedProvider === undefined) delete process.env.AI_PROVIDER
  else process.env.AI_PROVIDER = savedProvider
})

describe('GET /api/workspaces/me/ai-features', () => {
  it('serves any member the state the UI hides entry points with', async () => {
    asRole('MEMBER')
    findRaw.mockResolvedValue({ features: { turnSummary: false } })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.aiConfigured).toBe(true)
    expect(body.effective.turnSummary).toBe(false)
    expect(body.effective.runSummary).toBe(true)
    expect(body.available).not.toContain('prCodeReview')
  })

  it('reports everything off on a deployment without a model', async () => {
    asRole('OWNER')
    process.env.AI_PROVIDER = 'none'
    const body = await (await GET()).json()
    expect(body.aiConfigured).toBe(false)
    expect(Object.values(body.effective)).not.toContain(true)
  })
})

describe('PATCH /api/workspaces/me/ai-features', () => {
  it('writes one switch for an OWNER', async () => {
    asRole('OWNER')
    const res = await patch({ level: 'group', key: 'memory', enabled: false })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('w1', {
      aiFeatureSwitches: { groups: { memory: false } },
    })
  })

  it('refuses a MEMBER', async () => {
    asRole('MEMBER')
    const res = await patch({ level: 'master', enabled: false })
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses to turn the master switch on without a model, with a code', async () => {
    asRole('OWNER')
    process.env.AI_PROVIDER = 'none'
    const res = await patch({ level: 'master', enabled: true })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('AI_NOT_CONFIGURED')
    expect(update).not.toHaveBeenCalled()
  })

  it('rejects an unknown feature key', async () => {
    asRole('OWNER')
    const res = await patch({ level: 'feature', key: 'nope', enabled: false })
    expect(res.status).toBe(400)
  })
})
