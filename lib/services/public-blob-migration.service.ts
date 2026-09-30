import { createHash } from 'node:crypto'
import type {
  ReferenceRow,
  ReferenceSource,
} from '@/lib/repositories/public-blob-migration.repository'
import {
  evidencePathname,
  fileRouteUrl,
  imagePathname,
} from '@/lib/files/private-file-path'

/**
 * LUM-916 — one-off migration of the uploads stored before LUM-916 as PUBLIC
 * blobs (test evidence under `test-evidence/`, editor images under
 * `documents/`) to private blobs behind the file route.
 *
 * Read-only unless `apply`. With `apply`:
 *   1. copy each referenced public blob to its private path — evidence keeps
 *      its task/case prefix; an image gets one copy per workspace whose rows
 *      reference it, under `workspaces/<id>/images/`
 *   2. rewrite every stored reference to the file-route URL
 *   3. delete a public original once no stored reference still needs it
 *   4. with `deleteOrphans`, also delete public blobs nothing references
 *
 * Target paths are derived from the source URL, so a re-run after a crash
 * overwrites the same private copies instead of leaking new ones, and a run
 * after a complete one finds nothing to do.
 */

export interface MigrationDeps {
  listPublicBlobs(
    prefix: string
  ): Promise<Array<{ url: string; pathname: string }>>
  copyToPrivate(publicUrl: string, privatePathname: string): Promise<void>
  deletePublic(urls: string[]): Promise<void>
  findTaskWorkspaceId(taskId: string): Promise<string | null>
  sources: ReferenceSource[]
}

export interface MigrationOptions {
  apply: boolean
  deleteOrphans: boolean
  /** Origin the rewritten URLs point at, e.g. https://www.uselumo.ai */
  origin: string
}

export interface MigrationReport {
  publicBlobs: { evidence: number; images: number }
  /** Rows per source that reference a public evidence/image blob. */
  referencingRows: Record<string, number>
  /** Private copies to make (one per evidence blob, one per image×workspace). */
  copies: number
  /** Public blobs nothing references — only removed with deleteOrphans. */
  orphans: { evidence: number; images: number }
  /** References to public URLs that no longer exist in the store. */
  dangling: number
  /** Public blobs kept because a reference has no owning workspace (a
   *  global template) or the evidence's task is gone. */
  kept: number
  applied: {
    copied: number
    rowsRewritten: number
    originalsDeleted: number
    orphansDeleted: number
  }
}

const PUBLIC_URL_RE =
  /https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/(?:test-evidence|documents)\/[^\s"'<>()?#\\]+/g

const EVIDENCE_RE =
  /^test-evidence\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([^/]+)$/

function stableId(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 32)
}

type Blob = { url: string; pathname: string }
type Ref = { source: ReferenceSource; row: ReferenceRow }

export async function migratePublicBlobs(
  deps: MigrationDeps,
  opts: MigrationOptions
): Promise<MigrationReport> {
  const evidenceBlobs = await deps.listPublicBlobs('test-evidence/')
  const imageBlobs = await deps.listPublicBlobs('documents/')
  const byUrl = new Map<string, Blob>(
    [...evidenceBlobs, ...imageBlobs].map(b => [b.url, b])
  )

  // ── Who references what ────────────────────────────────────────────────
  const refsByUrl = new Map<string, Ref[]>()
  const referencingRows: Record<string, number> = {}
  const rows: Ref[] = []
  let dangling = 0
  for (const source of deps.sources) {
    for (const row of await source.findRows()) {
      const urls = new Set(row.text.match(PUBLIC_URL_RE) ?? [])
      let counted = false
      for (const url of urls) {
        if (!byUrl.has(url)) {
          dangling++
          continue
        }
        const list = refsByUrl.get(url) ?? []
        list.push({ source, row })
        refsByUrl.set(url, list)
        counted = true
      }
      if (counted) {
        referencingRows[source.name] = (referencingRows[source.name] ?? 0) + 1
        rows.push({ source, row })
      }
    }
  }

  // ── Where each reference goes ──────────────────────────────────────────
  // key: `${url}\u0000${rowWorkspaceId}` for images, `${url}` for evidence
  const targetFor = new Map<string, string>()
  const copies = new Map<string, string>() // private pathname → public url
  const keptUrls = new Set<string>()
  const orphans = { evidence: 0, images: 0 }
  const orphanUrls: string[] = []

  for (const blob of evidenceBlobs) {
    const refs = refsByUrl.get(blob.url) ?? []
    const m = EVIDENCE_RE.exec(blob.pathname)
    const owner = m ? await deps.findTaskWorkspaceId(m[1] as string) : null
    if (refs.length === 0) {
      orphans.evidence++
      orphanUrls.push(blob.url)
      continue
    }
    if (!m || !owner) {
      keptUrls.add(blob.url)
      continue
    }
    const stem = (m[3] as string).replace(/\.[A-Za-z0-9]{1,8}$/, '')
    const fileId = /^[A-Za-z0-9_-]{1,64}$/.test(stem)
      ? stem
      : stableId(blob.url)
    const target = evidencePathname(m[1] as string, m[2] as string, fileId)
    targetFor.set(blob.url, target)
    copies.set(target, blob.url)
  }

  for (const blob of imageBlobs) {
    const refs = refsByUrl.get(blob.url) ?? []
    if (refs.length === 0) {
      orphans.images++
      orphanUrls.push(blob.url)
      continue
    }
    for (const { row } of refs) {
      if (!row.workspaceId) {
        keptUrls.add(blob.url)
        continue
      }
      const target = imagePathname(
        row.workspaceId,
        stableId(`${blob.url}\u0000${row.workspaceId}`)
      )
      targetFor.set(`${blob.url}\u0000${row.workspaceId}`, target)
      copies.set(target, blob.url)
    }
  }

  const report: MigrationReport = {
    publicBlobs: { evidence: evidenceBlobs.length, images: imageBlobs.length },
    referencingRows,
    copies: copies.size,
    orphans,
    dangling,
    kept: keptUrls.size,
    applied: {
      copied: 0,
      rowsRewritten: 0,
      originalsDeleted: 0,
      orphansDeleted: 0,
    },
  }
  if (!opts.apply) return report

  // 1. Copy first: a reference is only ever rewritten to a copy that exists.
  for (const [target, url] of copies) {
    await deps.copyToPrivate(url, target)
    report.applied.copied++
  }

  // 2. Rewrite references.
  for (const { source, row } of rows) {
    const next = row.text.replace(PUBLIC_URL_RE, url => {
      const target =
        targetFor.get(url) ?? targetFor.get(`${url}\u0000${row.workspaceId}`)
      return target ? fileRouteUrl(opts.origin, target) : url
    })
    if (next !== row.text) {
      await source.write(row, next)
      report.applied.rowsRewritten++
    }
  }

  // 3. Originals no reference needs any more.
  const done = [...refsByUrl.keys()].filter(u => !keptUrls.has(u))
  if (done.length > 0) {
    await deps.deletePublic(done)
    report.applied.originalsDeleted = done.length
  }

  // 4. Orphans, only on request.
  if (opts.deleteOrphans && orphanUrls.length > 0) {
    await deps.deletePublic(orphanUrls)
    report.applied.orphansDeleted = orphanUrls.length
  }

  return report
}
