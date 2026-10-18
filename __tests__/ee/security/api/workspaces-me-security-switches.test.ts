/**
 * @jest-environment node
 *
 * LUM-866 — the security-scan switches through GET/PATCH /api/workspaces/me,
 * with the real route, zod schema and workspace service; only auth and the
 * repository are mocked.
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

const WORKSPACE = {
  id: 'w1',
  slug: 'acme',
  name: 'Acme',
  // The column defaults an existing workspace gets from the migration.
  securityScanEnabled: true,
  securityAiReviewEnabled: true,
  securityHuntEnabled: true,
}

function asRole(role: 'OWNER' | 'MEMBER') {
  ;(requireAuth as jest.Mock).mockResolvedValue({ userId: 'u1' })
  ;(requireUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    workspace: WORKSPACE,
    member: { id: 'm1', role },
  })
}

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/workspaces/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.LUMO_SECURITY_HUNT
  delete process.env.LUMO_MANAGED_SCAN
  update.mockImplementation(async (_id: string, data: object) => ({
    ...WORKSPACE,
    ...data,
  }))
})

afterAll(() => {
  delete process.env.LUMO_SECURITY_HUNT
  delete process.env.LUMO_MANAGED_SCAN
})

describe('LUM-866 workspace switches settings API', () => {
  it('GET returns the stored switches (all on by default) and the platform ceiling', async () => {
    asRole('OWNER')
    const body = await (await GET()).json()
    expect(body.workspace).toMatchObject({
      securityScanEnabled: true,
      securityAiReviewEnabled: true,
      securityHuntEnabled: true,
    })
    expect(body.securityPlatform).toEqual({
      managedScan: true,
      hunt: true,
      rewardHack: false,
      sandbox: true,
    })
  })

  it('GET reports a layer the platform env turned off', async () => {
    asRole('OWNER')
    process.env.LUMO_SECURITY_HUNT = 'off'
    const body = await (await GET()).json()
    expect(body.securityPlatform).toEqual({
      managedScan: true,
      hunt: false,
      rewardHack: false,
      sandbox: true,
    })
  })

  it('an OWNER PATCH persists the three switches', async () => {
    asRole('OWNER')
    const res = await patch({
      securityScanEnabled: false,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('w1', {
      securityScanEnabled: false,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
    expect((await res.json()).workspace).toMatchObject({
      securityScanEnabled: false,
      securityAiReviewEnabled: false,
      securityHuntEnabled: false,
    })
  })

  it('a PATCH of one switch leaves the others untouched', async () => {
    asRole('OWNER')
    await patch({ securityHuntEnabled: false })
    expect(update).toHaveBeenCalledWith('w1', { securityHuntEnabled: false })
  })

  it('a non-OWNER is refused 403 and nothing is written', async () => {
    asRole('MEMBER')
    const res = await patch({ securityScanEnabled: false })
    expect(res.status).toBe(403)
    expect(update).not.toHaveBeenCalled()
  })

  it('a non-boolean value is rejected 400', async () => {
    asRole('OWNER')
    const res = await patch({ securityScanEnabled: 'off' })
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
