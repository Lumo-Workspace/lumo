/**
 * @jest-environment node
 */
// LUM-1021 security red line on the local-disk backend: private uploads are
// readable ONLY through the authorising routes, never through the public
// blob route, and batch/prefix sweeps clear both namespaces.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

const dir = mkdtempSync(join(tmpdir(), 'lum1021-routes-'))
const savedEnv = { ...process.env }
delete process.env.BLOB_READ_WRITE_TOKEN
delete process.env.BLOB_PRIVATE_READ_WRITE_TOKEN
delete process.env.S3_BUCKET
delete process.env.BLOB_STORAGE
process.env.LOCAL_BLOB_DIR = dir

const requireIdentity = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => requireIdentity(...a),
}))
const findTaskWorkspaceId = jest.fn()
const findSharedDocument = jest.fn()
jest.mock('@/lib/repositories/private-file.repository', () => ({
  privateFileRepository: {
    findTaskWorkspaceId: (...a: unknown[]) => findTaskWorkspaceId(...a),
    findSharedDocument: (...a: unknown[]) => findSharedDocument(...a),
  },
}))

import { GET as readFile } from '@/app/api/files/[...path]/route'
import { GET as readPublic } from '@/app/api/blob/public/[...path]/route'
import { privateFileService } from '@/lib/services/private-file.service'
import { uploadWorkspaceLogo } from '@/lib/services/workspace-logo-blob'
import {
  deleteExportArchive,
  openExportArchive,
  putExportArchive,
} from '@/lib/services/workspace-export-blob'
import { deleteBlobsByPrefixInBothStores } from '@/lib/services/workspace-deletion-blob'
import { getBlobStorage } from '@/lib/blob/storage'

afterAll(() => {
  process.env = savedEnv
  rmSync(dir, { recursive: true, force: true })
})

const anonymous = () =>
  NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const member = (workspaceId: string) => ({
  clerkId: 'u',
  memberId: 'm',
  workspaceId,
  workspaceSlug: 's',
  workspaceName: 'n',
  source: 'clerk' as const,
})
const params = (p: string) => ({
  params: Promise.resolve({ path: p.split('/') }),
})
const fileReq = (p: string, q = '') =>
  readFile(new NextRequest(`http://app.test/api/files/${p}${q}`), params(p))
const publicReq = (p: string) =>
  readPublic(new Request(`http://app.test/api/blob/public/${p}`), params(p))

let evidencePath: string

beforeAll(async () => {
  findTaskWorkspaceId.mockResolvedValue('ws-a')
  findSharedDocument.mockResolvedValue(null)
  const url = await privateFileService.storeEvidence(
    'task-1',
    'case-1',
    new File(['secret evidence'], 'e.txt', { type: 'text/plain' }),
    'http://app.test'
  )
  evidencePath = new URL(url).pathname.replace('/api/files/', '')
})

describe('private evidence on disk', () => {
  it('is backed by the disk backend', async () => {
    expect((await getBlobStorage()).kind).toBe('disk')
  })

  it('anonymous read → 401, other workspace → 404, owner → 200 with the bytes', async () => {
    requireIdentity.mockResolvedValue(anonymous())
    expect((await fileReq(evidencePath)).status).toBe(401)

    requireIdentity.mockResolvedValue(member('ws-b'))
    expect((await fileReq(evidencePath)).status).toBe(404)

    requireIdentity.mockResolvedValue(member('ws-a'))
    const ok = await fileReq(evidencePath)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('secret evidence')
    expect(ok.headers.get('content-type')).toBe('text/plain')
  })

  it('the public blob route never serves it — by pathname or by traversal', async () => {
    expect((await publicReq(evidencePath)).status).toBe(404)
    expect((await publicReq(`../private/${evidencePath}`)).status).toBe(404)
  })
})

describe('public blob route', () => {
  it('serves a logo anonymously, but not a private object at a logo-shaped path', async () => {
    const url = await uploadWorkspaceLogo(
      'workspaces/ws-a/logo-1.png',
      new File(['png!'], 'l.png', { type: 'image/png' })
    )
    expect(url).toBe('/api/blob/public/workspaces/ws-a/logo-1.png')
    const res = await publicReq('workspaces/ws-a/logo-1.png')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('png!')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    const storage = await getBlobStorage()
    await storage.put('workspaces/ws-a/logo-2.png', Buffer.from('private!'), {
      access: 'private',
    })
    expect((await publicReq('workspaces/ws-a/logo-2.png')).status).toBe(404)
  })

  it('refuses non-logo pathnames even in the public namespace', async () => {
    const storage = await getBlobStorage()
    await storage.put('workspaces/ws-a/notes.txt', Buffer.from('x'), {
      access: 'public',
    })
    expect((await publicReq('workspaces/ws-a/notes.txt')).status).toBe(404)
  })
})

describe('exports and prefix sweeps on disk', () => {
  it('export archive put → open → delete', async () => {
    const url = await putExportArchive(
      'ws-a',
      'exp-1',
      new Uint8Array([1, 2, 3])
    )
    expect(url).toMatch(
      /^lumo-blob:private\/workspaces\/ws-a\/exports\/exp-1\//
    )
    const opened = await openExportArchive(url)
    expect(opened?.size).toBe(3)
    await new Response(opened!.stream).arrayBuffer()
    await expect(deleteExportArchive('ws-a', 'exp-1')).resolves.toBe(1)
    await expect(openExportArchive(url)).resolves.toBeNull()
  })

  it('workspace deletion sweeps both namespaces', async () => {
    await privateFileService.storeImage(
      'ws-z',
      new File(['img'], 'i.png', { type: 'image/png' }),
      'http://app.test'
    )
    await uploadWorkspaceLogo(
      'workspaces/ws-z/logo-9.png',
      new File(['png'], 'l.png', { type: 'image/png' })
    )
    await expect(
      deleteBlobsByPrefixInBothStores('workspaces/ws-z/')
    ).resolves.toBe(2)
    const storage = await getBlobStorage()
    for (const access of ['public', 'private'] as const)
      expect(
        (await storage.list({ access, prefix: 'workspaces/ws-z/' })).blobs
      ).toEqual([])
  })
})
