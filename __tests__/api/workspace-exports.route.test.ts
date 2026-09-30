/**
 * @jest-environment node
 *
 * LUM-858 — POST/GET /api/workspaces/me/exports and the download route, with
 * the real routes and export service; auth, repository, blob store and the
 * workflow starter are mocked.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/auth', () => ({ requireAuth: jest.fn() }))
jest.mock('@/lib/api/helpers', () => ({
  ...jest.requireActual('@/lib/api/helpers'),
  requireUserWorkspace: jest.fn(),
}))
jest.mock('@/lib/repositories/workspace-export.repository', () => ({
  ...jest.requireActual('@/lib/repositories/workspace-export.repository'),
  workspaceExportRepository: {
    create: jest.fn(),
    findActive: jest.fn(),
    findById: jest.fn(),
    listRecent: jest.fn(),
    setWorkflowRun: jest.fn(),
    markFailed: jest.fn(),
    recordDownload: jest.fn(),
  },
}))
jest.mock('@/lib/services/workspace-export-blob', () => ({
  openExportArchive: jest.fn(),
  deleteExportArchive: jest.fn(),
  putExportArchive: jest.fn(),
}))
jest.mock('@/lib/services/workspace-export-start', () => ({
  startWorkspaceExport: jest.fn(),
}))
jest.mock('@/lib/services', () => ({
  workspaceExportService: jest.requireActual(
    '@/lib/services/workspace-export.service'
  ).workspaceExportService,
}))

import { GET as list, POST } from '@/app/api/workspaces/me/exports/route'
import { GET as download } from '@/app/api/workspaces/me/exports/[id]/download/route'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { workspaceExportRepository as repo } from '@/lib/repositories/workspace-export.repository'
import { openExportArchive } from '@/lib/services/workspace-export-blob'
import { startWorkspaceExport } from '@/lib/services/workspace-export-start'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const NOW = new Date('2026-09-30T10:00:00Z')

function asRole(role: 'OWNER' | 'MEMBER') {
  m(requireAuth).mockResolvedValue({ userId: 'user_1' })
  m(requireUserWorkspace).mockResolvedValue({
    workspaceId: 'w1',
    workspace: { id: 'w1', slug: 'acme' },
    member: { id: 'm1', role },
  })
}

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'exp1',
    workspaceId: 'w1',
    requestedByClerkId: 'user_1',
    status: 'PENDING',
    blobUrl: null,
    sizeBytes: null,
    rowCounts: null,
    error: null,
    completedAt: null,
    expiresAt: null,
    downloadCount: 0,
    lastDownloadedAt: null,
    createdAt: NOW,
    ...over,
  }
}

const downloadOf = (id: string) =>
  download(
    new Request(`http://localhost/api/workspaces/me/exports/${id}/download`),
    {
      params: Promise.resolve({ id }),
    }
  )

beforeEach(() => jest.clearAllMocks())

describe('POST /api/workspaces/me/exports', () => {
  it('LUM-858 start export route: owner POST answers 202 with the pending export', async () => {
    asRole('OWNER')
    m(repo.findActive).mockResolvedValue(null)
    m(repo.create).mockResolvedValue(record())
    m(startWorkspaceExport).mockResolvedValue('run_1')

    const res = await POST()

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body).toMatchObject({
      started: true,
      export: { id: 'exp1', status: 'PENDING' },
    })
    expect(JSON.stringify(body)).not.toContain('blobUrl')
  })

  it('LUM-858 start export route: member POST answers 403 and creates nothing', async () => {
    asRole('MEMBER')

    const res = await POST()

    expect(res.status).toBe(403)
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('LUM-858 start export route: an in-progress export answers 200 without a new run', async () => {
    asRole('OWNER')
    m(repo.findActive).mockResolvedValue(record({ status: 'RUNNING' }))

    const res = await POST()

    expect(res.status).toBe(200)
    expect((await res.json()).started).toBe(false)
    expect(startWorkspaceExport).not.toHaveBeenCalled()
  })

  it('LUM-858 start export route: member GET list answers 403', async () => {
    asRole('MEMBER')
    expect((await list()).status).toBe(403)
  })
})

describe('GET /api/workspaces/me/exports/[id]/download', () => {
  const ready = (expiresAt: Date) =>
    record({
      status: 'READY',
      blobUrl: 'https://blob.test/private/exp1.zip',
      completedAt: NOW,
      expiresAt,
    })

  it('LUM-858 download route: owner receives the zip as an attachment and the download is recorded', async () => {
    asRole('OWNER')
    m(repo.findById).mockResolvedValue(ready(new Date(Date.now() + 86_400_000)))
    const bytes = new TextEncoder().encode('PK-zip-bytes')
    m(openExportArchive).mockResolvedValue({
      stream: new Response(bytes).body,
      size: bytes.length,
    })

    const res = await downloadOf('exp1')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="lumo-acme-export-2026-09-30.zip"'
    )
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes)
    expect(repo.recordDownload).toHaveBeenCalledWith(
      'exp1',
      'user_1',
      expect.any(Date)
    )
  })

  it('LUM-858 download route: an expired export answers 410', async () => {
    asRole('OWNER')
    m(repo.findById).mockResolvedValue(ready(new Date(Date.now() - 1000)))

    const res = await downloadOf('exp1')

    expect(res.status).toBe(410)
    expect(openExportArchive).not.toHaveBeenCalled()
    expect(repo.recordDownload).not.toHaveBeenCalled()
  })

  it('LUM-858 download route: a member answers 403', async () => {
    asRole('MEMBER')
    expect((await downloadOf('exp1')).status).toBe(403)
    expect(repo.findById).not.toHaveBeenCalled()
  })
})
