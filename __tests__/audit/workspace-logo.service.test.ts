/**
 * @jest-environment node
 *
 * LUM-907 PR3: the workspace logo — OWNER check moved from the route into
 * workspaceLogoService, and the change is audited.
 */
jest.mock('@/lib/services/workspace-logo-blob', () => ({
  uploadWorkspaceLogo: jest.fn(
    async (path: string) => `https://blob.test/${path}`
  ),
  deleteWorkspaceLogo: jest.fn(async () => undefined),
}))
const mockPut = jest.fn(async () => ({ url: 'https://blob.test/put.png' }))
const mockDel = jest.fn(async () => undefined)
jest.mock('@vercel/blob', () => ({
  put: (...a: unknown[]) => mockPut(...(a as [])),
  del: (...a: unknown[]) => mockDel(...(a as [])),
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: { update: jest.fn() },
}))
const mockAudit = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/services/audit.service', () => ({
  ...jest.requireActual('@/lib/services/audit.service'),
  recordAuditEvent: (...a: unknown[]) => mockAudit(...a),
}))
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'clerk_1' })),
  getUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}))

import { NextRequest } from 'next/server'
import {
  logoExtension,
  workspaceLogoService,
} from '@/lib/services/workspace-logo.service'
import {
  deleteWorkspaceLogo,
  uploadWorkspaceLogo,
} from '@/lib/services/workspace-logo-blob'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import { getUserWorkspace } from '@/lib/auth'
import { POST } from '@/app/api/workspaces/me/logo/route'

const png = (bytes = 10) =>
  new File([new Uint8Array(bytes)], 'logo.png', { type: 'image/png' })
const NOW = new Date('2026-10-04T00:00:00.000Z')
const owner = { workspaceId: 'w1', role: 'OWNER', currentLogoUrl: null }

beforeEach(() => jest.clearAllMocks())

describe('workspace logo service', () => {
  it('logo service: logoExtension maps the accepted types', () => {
    expect(logoExtension('image/png')).toBe('png')
    expect(logoExtension('image/webp')).toBe('webp')
    expect(logoExtension('image/jpeg')).toBe('jpg')
  })

  it('logo service: a MEMBER is refused 403 before anything is touched', async () => {
    await expect(
      workspaceLogoService.updateLogo({ ...owner, role: 'MEMBER' }, png())
    ).rejects.toMatchObject({ status: 403 })
    expect(uploadWorkspaceLogo).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('logo service: a missing, wrong-type or oversized file is 400', async () => {
    await expect(
      workspaceLogoService.updateLogo(owner, null)
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      workspaceLogoService.updateLogo(
        owner,
        new File(['x'], 'a.gif', { type: 'image/gif' })
      )
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      workspaceLogoService.updateLogo(owner, png(2 * 1024 * 1024 + 1))
    ).rejects.toMatchObject({ status: 400 })
    expect(workspaceRepository.update).not.toHaveBeenCalled()
  })

  it('logo service: an OWNER replaces the logo, the old blob goes, and the change is audited', async () => {
    const ctx = {
      actor: { type: 'MEMBER' as const, clerkId: 'c1' },
      source: 'WEB' as const,
    }
    const out = await workspaceLogoService.updateLogo(
      { ...owner, currentLogoUrl: 'https://blob.test/old.png' },
      png(),
      ctx,
      NOW
    )
    expect(deleteWorkspaceLogo).toHaveBeenCalledWith(
      'https://blob.test/old.png'
    )
    expect(out.logoUrl).toBe(
      `https://blob.test/workspaces/w1/logo-${NOW.getTime()}.png`
    )
    expect(workspaceRepository.update).toHaveBeenCalledWith('w1', {
      logoUrl: out.logoUrl,
    })
    expect(mockAudit).toHaveBeenCalledWith({
      workspaceId: 'w1',
      action: 'workspace.logo_updated',
      target: { type: 'workspace', id: 'w1' },
      metadata: { contentType: 'image/png', bytes: 10, replaced: true },
      context: ctx,
    })
  })
})

describe('POST /api/workspaces/me/logo', () => {
  const post = (file?: File) => {
    const form = new FormData()
    if (file) form.append('file', file)
    return new NextRequest('http://x/api/workspaces/me/logo', {
      method: 'POST',
      body: form,
    })
  }

  it('logo route: a MEMBER gets 403 from the service', async () => {
    ;(getUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1', role: 'MEMBER' },
      workspace: { logoUrl: null },
    })
    const res = await POST(post(png()))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'Only owners can change the logo',
    })
  })

  it('logo route: an OWNER upload returns the new URL and is audited with the web context', async () => {
    ;(getUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1', role: 'OWNER' },
      workspace: { logoUrl: null },
    })
    const res = await POST(post(png()))
    expect(res.status).toBe(200)
    expect((await res.json()).logoUrl).toMatch(
      /^https:\/\/blob\.test\/workspaces\/w1\/logo-\d+\.png$/
    )
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'workspace.logo_updated',
        context: expect.objectContaining({
          actor: { type: 'MEMBER', clerkId: 'clerk_1', memberId: 'm1' },
          source: 'WEB',
        }),
      })
    )
  })

  it('logo route: no workspace is 404, no file is 400', async () => {
    ;(getUserWorkspace as jest.Mock).mockResolvedValueOnce(null)
    expect((await POST(post(png()))).status).toBe(404)
    ;(getUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm1', role: 'OWNER' },
      workspace: { logoUrl: null },
    })
    expect((await POST(post())).status).toBe(400)
  })
})

describe('workspace logo blob wrapper', () => {
  const real = jest.requireActual<
    typeof import('@/lib/services/workspace-logo-blob')
  >('@/lib/services/workspace-logo-blob')

  it('logo blob: upload puts a public blob with the file type and returns its URL', async () => {
    const file = png()
    await expect(
      real.uploadWorkspaceLogo('workspaces/w1/logo-1.png', file)
    ).resolves.toBe('https://blob.test/put.png')
    expect(mockPut).toHaveBeenCalledWith('workspaces/w1/logo-1.png', file, {
      access: 'public',
      contentType: 'image/png',
    })
  })

  it('logo blob: delete ignores a blob that is already gone', async () => {
    mockDel.mockRejectedValueOnce(new Error('not found'))
    await expect(
      real.deleteWorkspaceLogo('https://blob.test/old.png')
    ).resolves.toBeUndefined()
  })
})
