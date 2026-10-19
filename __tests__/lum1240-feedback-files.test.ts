/**
 * @jest-environment node
 *
 * LUM-1240: feedback evidence lives at `workspaces/<ws>/feedback/<fileId>`.
 * The file route serves it only to the submitting workspace (another
 * workspace gets 404, a share token does not open it), and the workspace
 * deletion sweep of `workspaces/<ws>/` covers it.
 */
import { NextRequest, NextResponse } from 'next/server'

process.env.BLOB_PRIVATE_READ_WRITE_TOKEN = 'priv-token'

const requireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => requireIdentity(...a),
}))
const findSharedDocument = jest.fn()
jest.mock('@/lib/repositories/private-file.repository', () => ({
  privateFileRepository: {
    findTaskWorkspaceId: jest.fn(),
    findMilestoneWorkspaceId: jest.fn(),
    findSharedDocument: (...a: unknown[]) => findSharedDocument(...a),
  },
}))
const get = jest.fn()
jest.mock('@vercel/blob', () => ({
  put: jest.fn(),
  get: (...a: unknown[]) => get(...a),
}))

import { GET } from '@/app/api/files/[...path]/route'
import {
  feedbackEvidencePathname,
  parsePrivateFilePath,
  pathnameOf,
} from '@/lib/files/private-file-path'

const FILE = feedbackEvidencePathname(
  'ws-a',
  '1f2e3d4c-aaaa-bbbb-cccc-000011112222'
)

function identity(workspaceId: string) {
  return {
    clerkId: 'u',
    memberId: 'm',
    workspaceId,
    workspaceSlug: 's',
    workspaceName: 'n',
    source: 'bearer' as const,
  }
}

function read(pathname: string, query = '') {
  return GET(new NextRequest(`http://app.test/api/files/${pathname}${query}`), {
    params: Promise.resolve({ path: pathname.split('/') }),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  get.mockImplementation(async () => ({
    statusCode: 200,
    stream: new Blob(['bytes']).stream(),
    blob: { contentType: 'image/png', size: 5 },
  }))
})

describe('feedback evidence files', () => {
  it('round-trips through the path parser, under the workspace folder', () => {
    expect(FILE.startsWith('workspaces/ws-a/')).toBe(true)
    const parsed = parsePrivateFilePath(FILE)
    expect(parsed).toEqual({
      kind: 'feedback-evidence',
      workspaceId: 'ws-a',
      fileId: '1f2e3d4c-aaaa-bbbb-cccc-000011112222',
    })
    expect(pathnameOf(parsed!)).toBe(FILE)
    expect(parsePrivateFilePath('workspaces/ws-a/feedback/x/y')).toBeNull()
  })

  it('is served to the submitting workspace', async () => {
    requireIdentity.mockResolvedValue(identity('ws-a'))
    expect((await read(FILE)).status).toBe(200)
  })

  it('is a 404 for another workspace and never read', async () => {
    requireIdentity.mockResolvedValue(identity('ws-b'))
    expect((await read(FILE)).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })

  it('a public-document share token does not open it', async () => {
    requireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    findSharedDocument.mockResolvedValue({
      workspaceId: 'ws-a',
      content: `<img src="/api/files/${FILE}">`,
      sourceMarkdown: null,
    })
    expect((await read(FILE, '?share=tok')).status).toBe(404)
    expect(get).not.toHaveBeenCalled()
  })
})

describe('GDPR export carries feedback (LUM-1240, RFC Q12)', () => {
  it('has a feedback kind that reads the workspace rows and hides staff authors', async () => {
    jest.resetModules()
    const findMany = jest.fn(async () => [])
    jest.doMock('@/lib/db/prisma', () => ({
      prisma: { feedback: { findMany } },
    }))
    const { EXPORT_KINDS, workspaceExportRepository } =
      await import('@/lib/repositories/workspace-export.repository')
    const { EXPORTED_MODELS } = await import('@/lib/workspace/export-coverage')
    expect(EXPORT_KINDS).toContain('feedback')
    expect(EXPORTED_MODELS).toContain('Feedback')
    await workspaceExportRepository.pageRows('feedback', 'ws-a', null, 10)
    const arg = (
      findMany.mock.calls[0] as unknown as [
        { where: unknown; select: Record<string, unknown> },
      ]
    )[0]
    expect(arg.where).toEqual({ workspaceId: 'ws-a' })
    expect(arg.select.replies).toEqual({
      select: { body: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
    expect(arg.select).not.toHaveProperty('statusChangedById')
    expect(arg.select).not.toHaveProperty('seq')
  })
})
