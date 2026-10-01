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
 *
 * LUM-922 — production runs go in batches: `limit` migrates only the first N
 * referenced public blobs (all their copies, rewrites and originals), so
 * repeated limited runs converge on the full migration. `keepOriginals`
 * leaves every public blob in place — the rollback path — and those
 * originals show up as orphans on the next run, to be removed later with
 * `deleteOrphans` once the private copies have proven out.
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
  /** Migrate at most this many referenced public blobs this run. */
  limit?: number
  /** Delete no public blob at all (rewrite references only). */
  keepOriginals?: boolean
}

/** One migrated public blob and the file-route URLs that replaced it. */
export interface ManifestEntry {
  from: string
  to: string[]
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
  /** Distinct workspaces whose rows get a private copy (all batches). */
  workspaces: number
  /** Referenced public blobs this run would migrate / leaves for later. */
  batch: { selected: number; remaining: number }
  applied: {
    copied: number
    rowsRewritten: number
    originalsDeleted: number
    orphansDeleted: number
  }
  /** Apply only: every migrated public URL → its replacement URLs, the
   *  input for reversing the rewrite while the originals are kept. */
  manifest: ManifestEntry[]
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
  // Per public URL, its private copies keyed for the rewrite:
  // `${url}\u0000${rowWorkspaceId}` for images, `${url}` for evidence.
  const plans = new Map<
    string,
    Array<{ key: string; target: string; workspaceId: string }>
  >()
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
    plans.set(blob.url, [{ key: blob.url, target, workspaceId: owner }])
  }

  for (const blob of imageBlobs) {
    const refs = refsByUrl.get(blob.url) ?? []
    if (refs.length === 0) {
      orphans.images++
      orphanUrls.push(blob.url)
      continue
    }
    const plan: Array<{ key: string; target: string; workspaceId: string }> = []
    for (const { row } of refs) {
      if (!row.workspaceId) {
        keptUrls.add(blob.url)
        continue
      }
      const key = `${blob.url}\u0000${row.workspaceId}`
      plan.push({
        key,
        target: imagePathname(row.workspaceId, stableId(key)),
        workspaceId: row.workspaceId,
      })
    }
    if (plan.length > 0) plans.set(blob.url, plan)
  }

  // ── Which blobs this run takes (LUM-922 batches) ───────────────────────
  // A blob is the unit: its copies, rewrites and original move together, so
  // a batch never leaves one half-migrated. Only blobs with something to
  // migrate count, so kept-only blobs cannot starve later batches.
  const migratable = [...plans.keys()]
  const selected = new Set(
    opts.limit === undefined ? migratable : migratable.slice(0, opts.limit)
  )
  const targetFor = new Map<string, string>()
  const copies = new Map<string, string>() // private pathname → public url
  for (const url of selected) {
    for (const { key, target } of plans.get(url) ?? []) {
      targetFor.set(key, target)
      copies.set(target, url)
    }
  }

  const report: MigrationReport = {
    publicBlobs: { evidence: evidenceBlobs.length, images: imageBlobs.length },
    referencingRows,
    copies: copies.size,
    orphans,
    dangling,
    kept: keptUrls.size,
    workspaces: new Set(
      [...plans.values()].flatMap(plan =>
        plan.map(({ workspaceId }) => workspaceId)
      )
    ).size,
    batch: {
      selected: selected.size,
      remaining: migratable.length - selected.size,
    },
    applied: {
      copied: 0,
      rowsRewritten: 0,
      originalsDeleted: 0,
      orphansDeleted: 0,
    },
    manifest: [],
  }
  if (!opts.apply) return report

  // 1. Copy first: a reference is only ever rewritten to a copy that exists.
  for (const [target, url] of copies) {
    await deps.copyToPrivate(url, target)
    report.applied.copied++
  }

  // 2. Rewrite references.
  const replacements = new Map<string, Set<string>>()
  for (const { source, row } of rows) {
    const next = row.text.replace(PUBLIC_URL_RE, url => {
      const target =
        targetFor.get(url) ?? targetFor.get(`${url}\u0000${row.workspaceId}`)
      if (!target) return url
      const to = fileRouteUrl(opts.origin, target)
      const seen = replacements.get(url) ?? new Set<string>()
      seen.add(to)
      replacements.set(url, seen)
      return to
    })
    if (next !== row.text) {
      await source.write(row, next)
      report.applied.rowsRewritten++
    }
  }
  report.manifest = [...replacements].map(([from, to]) => ({
    from,
    to: [...to],
  }))

  // 3. Originals no reference needs any more.
  const done = [...refsByUrl.keys()].filter(
    u => selected.has(u) && !keptUrls.has(u)
  )
  if (done.length > 0 && !opts.keepOriginals) {
    await deps.deletePublic(done)
    report.applied.originalsDeleted = done.length
  }

  // 4. Orphans, only on request.
  if (opts.deleteOrphans && !opts.keepOriginals && orphanUrls.length > 0) {
    await deps.deletePublic(orphanUrls)
    report.applied.orphansDeleted = orphanUrls.length
  }

  return report
}
