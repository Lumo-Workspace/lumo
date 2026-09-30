/**
 * @jest-environment node
 */

/**
 * LUM-916: the one-off public→private blob migration, driven through the
 * real service against an in-memory blob store and in-memory reference rows.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import {
  migratePublicBlobs,
  type MigrationDeps,
} from '@/lib/services/public-blob-migration.service'
import type {
  ReferenceRow,
  ReferenceSource,
} from '@/lib/repositories/public-blob-migration.repository'

const HOST = 'https://store1.public.blob.vercel-storage.com'
const EVIDENCE_PATH =
  'test-evidence/task-1/case-1/0b5c4a1e-7f7e-4a4e-9d1b-1a2b3c4d5e6f.png'
const EVIDENCE_URL = `${HOST}/${EVIDENCE_PATH}`
const SHARED_IMG = `${HOST}/documents/doc-1/1748000000000-abc123.png`
const TEMPLATE_IMG = `${HOST}/documents/misc/1748000000001-def456.png`
const ORPHAN_IMG = `${HOST}/documents/misc/1748000000002-ghi789.png`
const GONE_IMG = `${HOST}/documents/misc/1748000000003-gone00.png`
const ORIGIN = 'https://www.uselumo.ai'

interface FakeRow extends ReferenceRow {
  writes: number
}

function world() {
  const publicBlobs = new Map<string, string>([
    [EVIDENCE_URL, EVIDENCE_PATH],
    [SHARED_IMG, 'documents/doc-1/1748000000000-abc123.png'],
    [TEMPLATE_IMG, 'documents/misc/1748000000001-def456.png'],
    [ORPHAN_IMG, 'documents/misc/1748000000002-ghi789.png'],
    // a private blob under the same prefix is NOT listed as public
  ])
  const privateBlobs = new Map<string, string>() // pathname → source url
  const taskDescription: FakeRow = {
    id: 'task-a',
    workspaceId: 'ws-a',
    text: `<p>see <img src="${SHARED_IMG}"> and <a href="${GONE_IMG}">x</a></p>`,
    updatedAt: new Date('2026-01-01'),
    writes: 0,
  }
  const otherWorkspaceDoc: FakeRow = {
    id: 'doc-b',
    workspaceId: 'ws-b',
    text: `![shot](${SHARED_IMG})`,
    updatedAt: null,
    writes: 0,
  }
  const globalTemplate: FakeRow = {
    id: 'tpl-1',
    workspaceId: null,
    text: `<img src="${TEMPLATE_IMG}">`,
    updatedAt: null,
    writes: 0,
  }
  const run: FakeRow = {
    id: 'run-1',
    workspaceId: 'ws-a',
    text: JSON.stringify([
      {
        type: 'file',
        url: EVIDENCE_URL,
        filename: 'shot.png',
        contentType: 'image/png',
        size: 3,
      },
    ]),
    updatedAt: null,
    writes: 0,
  }

  const source = (name: string, rows: FakeRow[]): ReferenceSource => ({
    name,
    findRows: async () =>
      rows
        .filter(r => r.text.includes('.public.blob.vercel-storage.com/'))
        .map(r => ({ ...r })),
    write: async (row, text) => {
      const target = rows.find(r => r.id === row.id)!
      target.text = text
      target.writes++
    },
  })

  const deps: MigrationDeps = {
    listPublicBlobs: async prefix =>
      [...publicBlobs]
        .filter(([, p]) => p.startsWith(prefix))
        .map(([url, pathname]) => ({ url, pathname })),
    copyToPrivate: jest.fn(async (url: string, pathname: string) => {
      if (!publicBlobs.has(url)) throw new Error('missing')
      privateBlobs.set(pathname, url)
    }),
    deletePublic: jest.fn(async (urls: string[]) => {
      for (const u of urls) publicBlobs.delete(u)
    }),
    findTaskWorkspaceId: async id => (id === 'task-1' ? 'ws-a' : null),
    sources: [
      source('task.description', [taskDescription]),
      source('document.sourceMarkdown', [otherWorkspaceDoc]),
      source('documentTemplate.content', [globalTemplate]),
      source('testCaseRun.evidence', [run]),
    ],
  }
  return {
    deps,
    publicBlobs,
    privateBlobs,
    rows: { taskDescription, otherWorkspaceDoc, globalTemplate, run },
  }
}

describe('public blob migration', () => {
  it('dry run reports what it would do and writes nothing', async () => {
    const w = world()
    const before = JSON.stringify(w.rows)
    const report = await migratePublicBlobs(w.deps, {
      apply: false,
      deleteOrphans: false,
      origin: ORIGIN,
    })

    expect(report).toMatchObject({
      publicBlobs: { evidence: 1, images: 3 },
      referencingRows: {
        'task.description': 1,
        'document.sourceMarkdown': 1,
        'documentTemplate.content': 1,
        'testCaseRun.evidence': 1,
      },
      // evidence ×1 + shared image ×2 workspaces; the template image has no
      // owning workspace, so it is kept public
      copies: 3,
      orphans: { evidence: 0, images: 1 },
      dangling: 1,
      kept: 1,
      applied: {
        copied: 0,
        rowsRewritten: 0,
        originalsDeleted: 0,
        orphansDeleted: 0,
      },
    })
    expect(w.deps.copyToPrivate).not.toHaveBeenCalled()
    expect(w.deps.deletePublic).not.toHaveBeenCalled()
    expect(JSON.stringify(w.rows)).toBe(before)
  })

  it('apply copies to private workspace paths, rewrites references and deletes the public originals', async () => {
    const w = world()
    const report = await migratePublicBlobs(w.deps, {
      apply: true,
      deleteOrphans: false,
      origin: ORIGIN,
    })
    expect(report.applied).toEqual({
      copied: 3,
      rowsRewritten: 3,
      originalsDeleted: 2,
      orphansDeleted: 0,
    })

    // Evidence keeps its task/case prefix, loses the extension.
    const evidenceTarget =
      'test-evidence/task-1/case-1/0b5c4a1e-7f7e-4a4e-9d1b-1a2b3c4d5e6f'
    expect(w.privateBlobs.get(evidenceTarget)).toBe(EVIDENCE_URL)
    const evidence = JSON.parse(w.rows.run.text) as Array<{ url: string }>
    expect(evidence[0]?.url).toBe(`${ORIGIN}/api/files/${evidenceTarget}`)

    // The shared image got one private copy per referencing workspace, and
    // each row points at its own workspace's copy.
    const imageTargets = [...w.privateBlobs.keys()].filter(p =>
      p.includes('/images/')
    )
    expect(imageTargets).toHaveLength(2)
    expect(
      imageTargets.some(p => p.startsWith('workspaces/ws-a/images/'))
    ).toBe(true)
    expect(
      imageTargets.some(p => p.startsWith('workspaces/ws-b/images/'))
    ).toBe(true)
    expect(w.rows.taskDescription.text).toMatch(
      new RegExp(
        `<img src="${ORIGIN}/api/files/workspaces/ws-a/images/[0-9a-f]{32}">`
      )
    )
    expect(w.rows.otherWorkspaceDoc.text).toMatch(
      new RegExp(
        `!\\[shot\\]\\(${ORIGIN}/api/files/workspaces/ws-b/images/[0-9a-f]{32}\\)`
      )
    )
    // updatedAt is carried to the write untouched
    expect(w.rows.taskDescription.updatedAt).toEqual(new Date('2026-01-01'))
    // a dangling link (blob already gone) is left as it was
    expect(w.rows.taskDescription.text).toContain(GONE_IMG)

    // No stored reference still points at a public URL that was migrated.
    for (const row of Object.values(w.rows)) {
      expect(row.text).not.toContain(SHARED_IMG)
      expect(row.text).not.toContain(EVIDENCE_URL)
    }
    // Originals of migrated blobs are gone; the template image (no owner)
    // and the orphan stay public.
    expect([...w.publicBlobs.keys()].sort()).toEqual(
      [ORPHAN_IMG, TEMPLATE_IMG].sort()
    )
    expect(w.rows.globalTemplate.text).toContain(TEMPLATE_IMG)
  })

  it('deletes unreferenced public blobs only with deleteOrphans', async () => {
    const w = world()
    const report = await migratePublicBlobs(w.deps, {
      apply: true,
      deleteOrphans: true,
      origin: ORIGIN,
    })
    expect(report.applied.orphansDeleted).toBe(1)
    expect(w.publicBlobs.has(ORPHAN_IMG)).toBe(false)
    expect(w.publicBlobs.has(TEMPLATE_IMG)).toBe(true)
  })

  it('a second run after a complete one is a no-op', async () => {
    const w = world()
    await migratePublicBlobs(w.deps, {
      apply: true,
      deleteOrphans: true,
      origin: ORIGIN,
    })
    const rowsAfterFirst = JSON.stringify(w.rows)
    ;(w.deps.copyToPrivate as jest.Mock).mockClear()
    ;(w.deps.deletePublic as jest.Mock).mockClear()

    const second = await migratePublicBlobs(w.deps, {
      apply: true,
      deleteOrphans: true,
      origin: ORIGIN,
    })
    expect(second.copies).toBe(0)
    expect(second.applied).toEqual({
      copied: 0,
      rowsRewritten: 0,
      originalsDeleted: 0,
      orphansDeleted: 0,
    })
    expect(w.deps.copyToPrivate).not.toHaveBeenCalled()
    expect(w.deps.deletePublic).not.toHaveBeenCalled()
    expect(JSON.stringify(w.rows)).toBe(rowsAfterFirst)
  })

  it('a re-run after a crash between copy and rewrite reuses the same private paths', async () => {
    const w = world()
    ;(w.deps.sources[0] as ReferenceSource).write = async () => {
      throw new Error('db blip')
    }
    await expect(
      migratePublicBlobs(w.deps, {
        apply: true,
        deleteOrphans: false,
        origin: ORIGIN,
      })
    ).rejects.toThrow('db blip')
    const firstCopies = new Set(w.privateBlobs.keys())
    expect(w.deps.deletePublic).not.toHaveBeenCalled() // nothing deleted before rewrites finish

    const fresh = world()
    fresh.deps.copyToPrivate = w.deps.copyToPrivate
    await migratePublicBlobs(fresh.deps, {
      apply: true,
      deleteOrphans: false,
      origin: ORIGIN,
    })
    expect(new Set(w.privateBlobs.keys())).toEqual(firstCopies)
  })
})
