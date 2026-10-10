/**
 * @jest-environment node
 *
 * LUM-1062 — GET/PATCH /api/workspaces/me on a server with no plugin
 * installed (the OSS snapshot): the security settings are neither served nor
 * accepted, and the core settings work as before. The real route, schemas
 * and workspace service run; only auth and the repository are mocked.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/plugins/installed', () => ({ INSTALLED_SERVER_PLUGINS: [] }))
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
    findAuditedSettings: jest.fn().mockResolvedValue(null),
  },
}))
jest.mock('@/lib/services', () => ({
  workspaceService: jest.requireActual('@/lib/services/workspace.service')
    .workspaceService,
  workspaceDeletionService: { getPending: jest.fn().mockResolvedValue(null) },
}))

import { GET, PATCH } from '@/app/api/workspaces/me/route'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'

const update = workspaceRepository.update as jest.Mock

/** A full row as Prisma returns it: the security columns are in the table. */
const WORKSPACE = {
  id: 'w1',
  slug: 'acme',
  name: 'Acme',
  aiDerivedContentEnabled: true,
  deadLetterRetentionDays: 7,
  securityPolicy: null,
  scanEvidenceRetentionDays: 7,
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    workspace: WORKSPACE,
    member: { id: 'm1', role: 'OWNER' },
  })
  update.mockImplementation(async (_id: string, data: object) => ({
    ...WORKSPACE,
    ...data,
  }))
})

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/workspaces/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

describe('LUM-1062 /api/workspaces/me without plugins', () => {
  it('GET serves the core columns only and no securityPlatform', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      workspace: {
        id: 'w1',
        slug: 'acme',
        name: 'Acme',
        aiDerivedContentEnabled: true,
        deadLetterRetentionDays: 7,
      },
      role: 'OWNER',
      pendingDeletion: null,
    })
  })

  it('PATCH of a security setting is refused 400 and nothing is written', async () => {
    for (const body of [
      { securityScanEnabled: false },
      { scanEvidenceRetentionDays: 0 },
      { securityPolicy: null, name: 'Acme Two' },
    ]) {
      const res = await patch(body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/Not available on this server/)
    }
    expect(update).not.toHaveBeenCalled()
  })

  it('PATCH of a core setting still works', async () => {
    const res = await patch({ aiDerivedContentEnabled: false })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('w1', {
      aiDerivedContentEnabled: false,
    })
  })
})
