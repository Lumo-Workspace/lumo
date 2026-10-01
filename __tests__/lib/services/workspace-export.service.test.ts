/**
 * @jest-environment node
 *
 * LUM-858 — GDPR workspace export service: starting an export (OWNER only, one
 * at a time), the archive it builds (manifest + NDJSON per kind + markdown per
 * document, secrets stripped), and the gated, recorded download.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}))
jest.mock('@/lib/repositories/workspace-export.repository', () => ({
  ...jest.requireActual('@/lib/repositories/workspace-export.repository'),
  workspaceExportRepository: {
    pageRows: jest.fn(),
    findWorkspaceMeta: jest.fn(),
    create: jest.fn(),
    findActive: jest.fn(),
    findById: jest.fn(),
    listRecent: jest.fn(),
    setWorkflowRun: jest.fn(),
    markRunning: jest.fn(),
    markReady: jest.fn(),
    markFailed: jest.fn(),
    markExpired: jest.fn(),
    recordDownload: jest.fn(),
  },
}))
jest.mock('@/lib/services/workspace-export-blob', () => ({
  putExportArchive: jest.fn(),
  openExportArchive: jest.fn(),
  deleteExportArchive: jest.fn(),
}))
jest.mock('@/lib/services/workspace-export-start', () => ({
  startWorkspaceExport: jest.fn(),
}))
jest.mock('@/lib/utils/clerk-helpers', () => ({
  lookupClerkProfiles: jest.fn(),
}))

import {
  EXPORT_KINDS,
  workspaceExportRepository as repo,
  type ExportKind,
} from '@/lib/repositories/workspace-export.repository'
import {
  buildWorkspaceArchive,
  EXPORT_PAGE_SIZE,
  workspaceExportService,
} from '@/lib/services/workspace-export.service'
import * as blob from '@/lib/services/workspace-export-blob'
import { startWorkspaceExport } from '@/lib/services/workspace-export-start'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import { readZipText } from '@/lib/archive/zip'

const m = <T>(fn: T) => fn as unknown as jest.Mock

const NOW = new Date('2026-09-30T10:00:00Z')

function record(over: Record<string, unknown> = {}) {
  return {
    id: 'exp1',
    workspaceId: 'w1',
    requestedByClerkId: 'user_owner',
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

/**
 * Credential-named fields planted in upstream rows; none may reach the
 * archive. Values are generated sentinels, not credential-shaped literals.
 */
const PLANTED_KEYS = [
  'accessToken',
  'refreshToken',
  'webhookSecret',
  'clientSecret',
  'keyHash',
  'token',
  'publicToken',
] as const
const PLANTED: Record<(typeof PLANTED_KEYS)[number], string> =
  Object.fromEntries(
    PLANTED_KEYS.map(k => [k, `sentinel-${k.length}-${k.toUpperCase()}`])
  ) as Record<(typeof PLANTED_KEYS)[number], string>

function rowsFor(kind: ExportKind): Record<string, unknown>[] {
  switch (kind) {
    case 'members':
      return [{ id: 'm1', clerkId: 'user_owner', role: 'OWNER', ...PLANTED }]
    case 'tasks':
      return [
        {
          id: 't1',
          title: 'Ship export',
          tagIds: ['tag1'],
          nested: { webhookSecret: PLANTED.webhookSecret, keep: 'yes' },
          createdAt: NOW,
        },
      ]
    case 'documents':
      return [
        {
          id: 'd1',
          number: 3,
          slug: 'launch plan',
          title: 'Launch plan',
          sourceMarkdown: '## Goals\n\n- ship',
          content: '<h2>Goals</h2>',
          publicToken: PLANTED.publicToken,
        },
        {
          id: 'd2',
          number: 4,
          slug: 'legacy',
          title: 'Legacy',
          sourceMarkdown: null,
          content: '<p>Hello <strong>world</strong></p>',
        },
      ]
    default:
      return [{ id: `${kind}-1`, name: kind, ...PLANTED }]
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  m(repo.findWorkspaceMeta).mockResolvedValue({
    id: 'w1',
    name: 'Acme',
    slug: 'acme',
    createdAt: NOW,
  })
  m(repo.pageRows).mockImplementation(
    async (kind: ExportKind, _ws: string, afterId: string | null) =>
      afterId ? [] : rowsFor(kind)
  )
  m(lookupClerkProfiles).mockResolvedValue(
    new Map([['user_owner', { name: 'Olive Owner', email: 'olive@acme.test' }]])
  )
})

describe('requestExport', () => {
  it('LUM-858 start export: owner creates a pending export and starts the workflow', async () => {
    m(repo.findActive).mockResolvedValue(null)
    m(repo.create).mockResolvedValue(record())
    m(startWorkspaceExport).mockResolvedValue('run_1')

    const res = await workspaceExportService.requestExport({
      workspaceId: 'w1',
      role: 'OWNER',
      clerkId: 'user_owner',
    })

    expect(res.started).toBe(true)
    expect(res.export).toMatchObject({ id: 'exp1', status: 'PENDING' })
    expect(res.export).not.toHaveProperty('blobUrl')
    expect(repo.create).toHaveBeenCalledWith('w1', 'user_owner')
    expect(startWorkspaceExport).toHaveBeenCalledWith('exp1', 'w1')
    expect(repo.setWorkflowRun).toHaveBeenCalledWith('exp1', 'run_1')
  })

  it('LUM-858 start export: a member is refused with 403 and nothing is created', async () => {
    await expect(
      workspaceExportService.requestExport({
        workspaceId: 'w1',
        role: 'MEMBER',
        clerkId: 'user_member',
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.create).not.toHaveBeenCalled()
    expect(startWorkspaceExport).not.toHaveBeenCalled()
  })

  it('LUM-858 start export: an export already in progress is returned, not started again', async () => {
    m(repo.findActive).mockResolvedValue(record({ status: 'RUNNING' }))

    const res = await workspaceExportService.requestExport({
      workspaceId: 'w1',
      role: 'OWNER',
      clerkId: 'user_owner',
    })

    expect(res).toMatchObject({ started: false, export: { status: 'RUNNING' } })
    expect(repo.create).not.toHaveBeenCalled()
    expect(startWorkspaceExport).not.toHaveBeenCalled()
  })

  it('LUM-858 start export: a run that cannot start marks the export failed and answers 503', async () => {
    m(repo.findActive).mockResolvedValue(null)
    m(repo.create).mockResolvedValue(record())
    m(startWorkspaceExport).mockResolvedValue(null)

    await expect(
      workspaceExportService.requestExport({
        workspaceId: 'w1',
        role: 'OWNER',
        clerkId: 'user_owner',
      })
    ).rejects.toMatchObject({ status: 503 })
    expect(repo.markFailed).toHaveBeenCalledWith('exp1', expect.any(String))
  })

  it('LUM-858 start export: listing is owner only', async () => {
    await expect(
      workspaceExportService.listExports('w1', 'MEMBER')
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('archive', () => {
  it('LUM-858 archive: zip holds manifest, one NDJSON per kind and markdown per document', async () => {
    const { bytes, rowCounts } = await buildWorkspaceArchive('w1', NOW)
    const files = await readZipText(bytes)

    for (const kind of EXPORT_KINDS) {
      expect(files).toHaveProperty([`${kind}.ndjson`])
    }
    for (const required of [
      'projects',
      'tasks',
      'comments',
      'documents',
      'milestones',
      'sprints',
      'ideas',
      'memories',
      'acceptance-criteria',
      'members',
    ]) {
      expect(EXPORT_KINDS).toContain(required)
    }

    const manifest = JSON.parse(files['manifest.json']!)
    expect(manifest).toMatchObject({
      format: 'lumo-workspace-export',
      version: 1,
      generatedAt: NOW.toISOString(),
      workspace: { id: 'w1', slug: 'acme' },
    })
    expect(manifest.files['tasks.ndjson']).toEqual({ rows: 1 })
    expect(manifest.notExported).toHaveProperty('GitHubIntegration')
    expect(rowCounts.documents).toBe(2)

    // Markdown per document: stored source when present, HTML converted otherwise.
    expect(files['documents/3-launch-plan.md']).toBe(
      '# Launch plan\n\n## Goals\n\n- ship\n'
    )
    expect(files['documents/4-legacy.md']).toContain('Hello **world**')
    const docs = files['documents.ndjson']!.trim()
      .split('\n')
      .map(l => JSON.parse(l))
    expect(docs[0]).toMatchObject({
      id: 'd1',
      markdownPath: 'documents/3-launch-plan.md',
    })
    expect(docs[0]).not.toHaveProperty('content')
    expect(docs[0]).not.toHaveProperty('sourceMarkdown')

    // Members carry the Clerk name + email; tasks keep their tag ids.
    const members = files['members.ndjson']!.trim()
      .split('\n')
      .map(l => JSON.parse(l))
    expect(members[0]).toMatchObject({
      clerkId: 'user_owner',
      name: 'Olive Owner',
      email: 'olive@acme.test',
      role: 'OWNER',
    })
    const tasks = files['tasks.ndjson']!.trim()
      .split('\n')
      .map(l => JSON.parse(l))
    expect(tasks[0]).toMatchObject({
      id: 't1',
      tagIds: ['tag1'],
      nested: { keep: 'yes' },
      createdAt: NOW.toISOString(),
    })
  })

  it('LUM-858 archive: planted secret fields never reach any archive file', async () => {
    const { bytes } = await buildWorkspaceArchive('w1', NOW)
    const files = await readZipText(bytes)
    const everything = Object.values(files).join('\n')

    for (const value of Object.values(PLANTED)) {
      expect(everything).not.toContain(value)
    }
    for (const key of Object.keys(PLANTED)) {
      expect(everything).not.toContain(`"${key}"`)
    }
  })

  it('LUM-858 archive: pages through tables larger than one page', async () => {
    const full = Array.from({ length: EXPORT_PAGE_SIZE }, (_, i) => ({
      id: `t${String(i).padStart(4, '0')}`,
    }))
    m(repo.pageRows).mockImplementation(
      async (kind: ExportKind, _ws: string, afterId: string | null) => {
        if (kind !== 'tasks') return []
        if (afterId === null) return full
        if (afterId === full[full.length - 1]!.id) return [{ id: 'tail' }]
        return []
      }
    )

    const { rowCounts } = await buildWorkspaceArchive('w1', NOW)

    expect(rowCounts.tasks).toBe(EXPORT_PAGE_SIZE + 1)
    expect(repo.pageRows).toHaveBeenCalledWith(
      'tasks',
      'w1',
      full[full.length - 1]!.id,
      EXPORT_PAGE_SIZE
    )
  })

  it('LUM-858 archive: generateArchive uploads privately and marks the export ready for 7 days', async () => {
    m(repo.findById).mockResolvedValue(record())
    m(repo.markRunning).mockResolvedValue(true)
    m(repo.markReady).mockResolvedValue(true)
    m(blob.putExportArchive).mockResolvedValue(
      'https://blob.test/private/exp1.zip'
    )

    await workspaceExportService.generateArchive('exp1', NOW)

    expect(repo.markRunning).toHaveBeenCalledWith('exp1')
    expect(blob.putExportArchive).toHaveBeenCalledWith(
      'w1',
      'exp1',
      expect.any(Uint8Array)
    )
    const [, ready] = m(repo.markReady).mock.calls[0]!
    expect(ready.blobUrl).toBe('https://blob.test/private/exp1.zip')
    expect(ready.expiresAt.getTime() - ready.completedAt.getTime()).toBe(
      7 * 24 * 60 * 60 * 1000
    )
    expect(ready.rowCounts).toHaveProperty('tasks', 1)
  })
})

describe('LUM-923 export race with workspace deletion', () => {
  beforeEach(() => {
    m(repo.markRunning).mockResolvedValue(true)
    m(blob.putExportArchive).mockResolvedValue(
      'https://blob.test/private/exp1.zip'
    )
  })

  it('LUM-923 export race: an export invalidated between the read and the build start is never revived', async () => {
    m(repo.findById).mockResolvedValue(record({ status: 'PENDING' }))
    m(repo.markRunning).mockResolvedValue(false)

    await workspaceExportService.generateArchive('exp1', NOW, 'w1')

    expect(blob.putExportArchive).not.toHaveBeenCalled()
    expect(repo.markReady).not.toHaveBeenCalled()
  })

  it('LUM-923 export race: an archive uploaded after the export was invalidated is deleted', async () => {
    m(repo.findById).mockResolvedValue(record({ status: 'RUNNING' }))
    const order: string[] = []
    m(blob.deleteExportArchive).mockImplementation(async () => {
      order.push('delete')
    })
    m(blob.putExportArchive).mockImplementation(async () => {
      order.push('put')
      return 'https://blob.test/private/exp1.zip'
    })
    // The workspace deletion failed the row (or deleted it) mid-build.
    m(repo.markReady).mockResolvedValue(false)

    await expect(
      workspaceExportService.generateArchive('exp1', NOW, 'w1')
    ).rejects.toThrow(/invalidated/)

    expect(order).toEqual(['delete', 'put', 'delete'])
    expect(blob.deleteExportArchive).toHaveBeenLastCalledWith('w1', 'exp1')
  })

  it('LUM-923 export race: a markReady that throws because the row is gone still deletes the upload', async () => {
    m(repo.findById).mockResolvedValue(record({ status: 'RUNNING' }))
    m(repo.markReady).mockRejectedValue(new Error('P2025 record not found'))

    await expect(
      workspaceExportService.generateArchive('exp1', NOW, 'w1')
    ).rejects.toThrow(/P2025/)

    const calls = m(blob.deleteExportArchive).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]).toEqual(['w1', 'exp1'])
  })

  it('LUM-923 export race: generate, fail and expire delete by workspaceId and exportId once the row is gone', async () => {
    m(repo.findById).mockResolvedValue(null)

    await expect(
      workspaceExportService.generateArchive('exp1', NOW, 'w1')
    ).rejects.toThrow(/not found/)
    await workspaceExportService.failExport('exp1', 'boom', 'w1')
    await workspaceExportService.expireExport('exp1', 'w1')

    expect(m(blob.deleteExportArchive).mock.calls).toEqual([
      ['w1', 'exp1'],
      ['w1', 'exp1'],
      ['w1', 'exp1'],
    ])
    expect(blob.putExportArchive).not.toHaveBeenCalled()
    expect(repo.markFailed).not.toHaveBeenCalled()
    expect(repo.markExpired).not.toHaveBeenCalled()
  })

  it('LUM-923 export race: an already-invalidated export is not rebuilt', async () => {
    m(repo.findById).mockResolvedValue(record({ status: 'FAILED' }))

    await workspaceExportService.generateArchive('exp1', NOW, 'w1')

    expect(repo.markRunning).not.toHaveBeenCalled()
    expect(blob.putExportArchive).not.toHaveBeenCalled()
  })
})

describe('download', () => {
  const ready = () =>
    record({
      status: 'READY',
      blobUrl: 'https://blob.test/private/exp1.zip',
      completedAt: NOW,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
    })
  const input = (over: Record<string, unknown> = {}) => ({
    workspaceId: 'w1',
    workspaceSlug: 'acme',
    role: 'OWNER' as const,
    clerkId: 'user_owner',
    exportId: 'exp1',
    now: new Date(NOW.getTime() + 60_000),
    ...over,
  })

  it('LUM-858 download: owner gets the private archive stream and the download is recorded', async () => {
    m(repo.findById).mockResolvedValue(ready())
    const stream = new ReadableStream<Uint8Array>()
    m(blob.openExportArchive).mockResolvedValue({ stream, size: 42 })

    const res = await workspaceExportService.openDownload(input())

    expect(blob.openExportArchive).toHaveBeenCalledWith(
      'https://blob.test/private/exp1.zip'
    )
    expect(res).toEqual({
      stream,
      size: 42,
      filename: 'lumo-acme-export-2026-09-30.zip',
    })
    expect(repo.recordDownload).toHaveBeenCalledWith(
      'exp1',
      'user_owner',
      input().now
    )
  })

  it('LUM-858 download: past its window the export answers 410 and records nothing', async () => {
    m(repo.findById).mockResolvedValue(ready())

    await expect(
      workspaceExportService.openDownload(
        input({ now: new Date(NOW.getTime() + 8 * 24 * 60 * 60 * 1000) })
      )
    ).rejects.toMatchObject({ status: 410 })
    m(repo.findById).mockResolvedValue(record({ status: 'EXPIRED' }))
    await expect(
      workspaceExportService.openDownload(input())
    ).rejects.toMatchObject({ status: 410 })

    expect(blob.openExportArchive).not.toHaveBeenCalled()
    expect(repo.recordDownload).not.toHaveBeenCalled()
  })

  it('LUM-858 download: member 403, other workspace 404, not ready 409', async () => {
    await expect(
      workspaceExportService.openDownload(input({ role: 'MEMBER' }))
    ).rejects.toMatchObject({ status: 403 })

    m(repo.findById).mockResolvedValue({ ...ready(), workspaceId: 'w2' })
    await expect(
      workspaceExportService.openDownload(input())
    ).rejects.toMatchObject({ status: 404 })

    m(repo.findById).mockResolvedValue(record({ status: 'RUNNING' }))
    await expect(
      workspaceExportService.openDownload(input())
    ).rejects.toMatchObject({ status: 409 })

    expect(repo.recordDownload).not.toHaveBeenCalled()
  })
})
