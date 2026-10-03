/**
 * @jest-environment node
 *
 * LUM-917 — the AI-derived content switch through PATCH /api/workspaces/me
 * and the status / delete route, with the real routes, zod schemas and
 * services; only auth and the repositories are mocked.
 */
import { NextRequest } from 'next/server'

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
  workspaceRepository: { update: jest.fn(), isSlugUnique: jest.fn() },
}))
jest.mock('@/lib/repositories/ai-derived-content.repository', () => ({
  aiDerivedContentRepository: {
    findEnabled: jest.fn(),
    countForWorkspace: jest.fn(),
    deleteMemoryBatch: jest.fn(),
    clearSessionSummaryBatch: jest.fn(),
    clearRunSummaryBatch: jest.fn(),
    clearClaimSnapshotBatch: jest.fn(),
    clearVerdictTextBatch: jest.fn(),
  },
}))
jest.mock('@/lib/services', () => ({
  workspaceService: jest.requireActual('@/lib/services/workspace.service')
    .workspaceService,
  aiDerivedContentService: jest.requireActual(
    '@/lib/services/ai-derived-content.service'
  ).aiDerivedContentService,
  workspaceDeletionService: { getPending: jest.fn().mockResolvedValue(null) },
}))

import { PATCH } from '@/app/api/workspaces/me/route'
import { GET, POST } from '@/app/api/workspaces/me/ai-derived-content/route'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { aiDerivedContentRepository } from '@/lib/repositories/ai-derived-content.repository'

const update = workspaceRepository.update as jest.Mock
const repo = aiDerivedContentRepository as unknown as Record<string, jest.Mock>

function asRole(role: 'OWNER' | 'MEMBER') {
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    workspace: { id: 'w1', slug: 'acme', name: 'Acme' },
    member: { id: 'm1', role },
  })
}

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  update.mockImplementation(async (_id: string, data: object) => data)
  repo.findEnabled!.mockResolvedValue(true)
  repo.countForWorkspace!.mockResolvedValue({
    memories: 2,
    sessionSummaries: 1,
    runSummaries: 1,
    claimSnapshots: 1,
    verdictTexts: 1,
  })
  repo.deleteMemoryBatch!.mockResolvedValue(2)
  repo.clearSessionSummaryBatch!.mockResolvedValue(1)
  repo.clearRunSummaryBatch!.mockResolvedValue(1)
  repo.clearClaimSnapshotBatch!.mockResolvedValue(1)
  repo.clearVerdictTextBatch!.mockResolvedValue(1)
})

describe('PATCH /api/workspaces/me aiDerivedContentEnabled (LUM-917)', () => {
  it('an OWNER turns AI-derived content off', async () => {
    asRole('OWNER')
    const res = await PATCH(
      json('http://localhost/api/workspaces/me', 'PATCH', {
        aiDerivedContentEnabled: false,
      })
    )
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('w1', {
      aiDerivedContentEnabled: false,
    })
  })

  it('a MEMBER cannot change it, and a non-boolean is rejected', async () => {
    asRole('MEMBER')
    const denied = await PATCH(
      json('http://localhost/api/workspaces/me', 'PATCH', {
        aiDerivedContentEnabled: false,
      })
    )
    expect(denied.status).toBe(403)
    asRole('OWNER')
    const bad = await PATCH(
      json('http://localhost/api/workspaces/me', 'PATCH', {
        aiDerivedContentEnabled: 'no',
      })
    )
    expect(bad.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('/api/workspaces/me/ai-derived-content (LUM-917)', () => {
  it('GET returns the switch and counts to an OWNER only', async () => {
    asRole('OWNER')
    const ok = await GET()
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({
      enabled: true,
      counts: {
        memories: 2,
        sessionSummaries: 1,
        runSummaries: 1,
        claimSnapshots: 1,
        verdictTexts: 1,
      },
    })
    asRole('MEMBER')
    expect((await GET()).status).toBe(403)
  })

  it('POST deletes only for an OWNER who re-typed the workspace name', async () => {
    const url = 'http://localhost/api/workspaces/me/ai-derived-content'
    asRole('MEMBER')
    expect(
      (await POST(json(url, 'POST', { confirmName: 'Acme' }))).status
    ).toBe(403)
    asRole('OWNER')
    expect((await POST(json(url, 'POST', {}))).status).toBe(400)
    expect(
      (await POST(json(url, 'POST', { confirmName: 'acme' }))).status
    ).toBe(400)
    expect(repo.deleteMemoryBatch).not.toHaveBeenCalled()

    const res = await POST(json(url, 'POST', { confirmName: 'Acme' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      deleted: {
        memories: 2,
        sessionSummaries: 1,
        runSummaries: 1,
        claimSnapshots: 1,
        verdictTexts: 1,
      },
      done: true,
    })
    expect(repo.deleteMemoryBatch).toHaveBeenCalledWith('w1', 500)
  })
})
