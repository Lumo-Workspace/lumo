/**
 * LUM-858 — GDPR workspace data export (right of access / portability).
 *
 * The OWNER asks for an export; a Vercel Workflow run builds a zip of the
 * workspace (one NDJSON file per kind + one markdown file per document +
 * manifest.json), stores it as a PRIVATE blob and keeps it downloadable for
 * EXPORT_TTL_DAYS, then deletes it. The `WorkspaceExport` row is the audit
 * trail: requester, status, row counts, and every download.
 *
 * Secrets never enter the archive twice over: the repository reads with
 * `select` allowlists, and `stripSecretFields` drops credential-named keys
 * from every row before it is written.
 */
import type { WorkspaceRole } from '@prisma/client'
import { logger } from '@/lib/logger'
import { createZipWriter } from '@/lib/archive/zip'
import { htmlToMarkdown } from '@/lib/utils/html-to-markdown'
import { lookupClerkProfiles } from '@/lib/utils/clerk-helpers'
import { EXCLUDED_MODELS } from '@/lib/workspace/export-coverage'
import { EXPORT_TTL_DAYS } from '@/lib/workspace/export-ttl'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'
import {
  EXPORT_KINDS,
  workspaceExportRepository as repo,
  type ExportRow,
  type WorkspaceExportRecord,
} from '@/lib/repositories/workspace-export.repository'

export const EXPORT_PAGE_SIZE = 500
/** `error` of an export whose workflow run was cancelled (LUM-1030). */
export const EXPORT_CANCELLED_REASON = 'export cancelled'
const RECENT_EXPORTS = 10
const DAY_MS = 24 * 60 * 60 * 1000

/** Keys that are never written to an archive, at any depth of a row. */
export const SECRET_FIELD_NAMES: ReadonlySet<string> = new Set([
  'accessToken',
  'refreshToken',
  'webhookSecret',
  'clientSecret',
  'keyHash',
  'token',
  'publicToken',
  'secret',
  'password',
  'apiKey',
  'blobUrl',
  'embedding',
])

/** What the settings page sees — never the blob URL. */
export interface WorkspaceExportView {
  id: string
  status: WorkspaceExportRecord['status']
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
  sizeBytes: number | null
  rowCounts: Record<string, number> | null
  downloadCount: number
  lastDownloadedAt: string | null
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

function assertOwner(role: WorkspaceRole) {
  if (role !== 'OWNER') {
    throw httpError('Only the workspace owner can export workspace data', 403)
  }
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null
}

function toView(r: WorkspaceExportRecord): WorkspaceExportView {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    completedAt: iso(r.completedAt),
    expiresAt: iso(r.expiresAt),
    sizeBytes: r.sizeBytes,
    rowCounts: (r.rowCounts as Record<string, number> | null) ?? null,
    downloadCount: r.downloadCount,
    lastDownloadedAt: iso(r.lastDownloadedAt),
  }
}

/** Drop credential-named keys from a row, recursively (Dates kept as-is). */
export function stripSecretFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretFields)
  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_FIELD_NAMES.has(k)) continue
    out[k] = stripSecretFields(v)
  }
  return out
}

function documentPath(row: ExportRow): string {
  const slug = String(row.slug ?? row.id).replace(/[^a-zA-Z0-9._-]+/g, '-')
  return `documents/${String(row.number ?? '')}-${slug}.md`
}

function documentMarkdown(row: ExportRow): string {
  const source =
    typeof row.sourceMarkdown === 'string' && row.sourceMarkdown.length > 0
      ? row.sourceMarkdown
      : htmlToMarkdown(typeof row.content === 'string' ? row.content : '')
  const title = typeof row.title === 'string' ? row.title : ''
  return title ? `# ${title}\n\n${source}\n` : `${source}\n`
}

async function withProfiles(rows: ExportRow[]): Promise<ExportRow[]> {
  const profiles = await lookupClerkProfiles(rows.map(r => String(r.clerkId)))
  return rows.map(r => {
    const p = profiles.get(String(r.clerkId))
    return { ...r, name: p?.name ?? null, email: p?.email ?? null }
  })
}

/** Build the zip for one workspace. Pure over the repository reads. */
export async function buildWorkspaceArchive(
  workspaceId: string,
  generatedAt: Date
): Promise<{ bytes: Uint8Array; rowCounts: Record<string, number> }> {
  const workspace = await repo.findWorkspaceMeta(workspaceId)
  if (!workspace) throw httpError('Workspace not found', 404)

  const zip = createZipWriter()
  const rowCounts: Record<string, number> = {}
  for (const kind of EXPORT_KINDS) {
    const file = zip.openText(`${kind}.ndjson`)
    let afterId: string | null = null
    let count = 0
    for (;;) {
      let rows = await repo.pageRows(
        kind,
        workspaceId,
        afterId,
        EXPORT_PAGE_SIZE
      )
      if (kind === 'members') rows = await withProfiles(rows)
      for (const row of rows) {
        let out: Record<string, unknown> = row
        if (kind === 'documents') {
          const path = documentPath(row)
          zip.addText(path, documentMarkdown(row))
          // The body lives in the markdown file, not twice in the NDJSON.
          out = { ...row, markdownPath: path }
          delete out.content
          delete out.sourceMarkdown
        }
        file.write(`${JSON.stringify(stripSecretFields(out))}\n`)
      }
      count += rows.length
      if (rows.length < EXPORT_PAGE_SIZE) break
      afterId = rows[rows.length - 1]!.id
    }
    file.close()
    rowCounts[kind] = count
  }

  const manifest = {
    format: 'lumo-workspace-export',
    version: 1,
    generatedAt: generatedAt.toISOString(),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      createdAt: workspace.createdAt.toISOString(),
    },
    files: Object.fromEntries(
      EXPORT_KINDS.map(k => [`${k}.ndjson`, { rows: rowCounts[k] }])
    ),
    documentsMarkdownDir: 'documents/',
    notExported: EXCLUDED_MODELS,
  }
  zip.addText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  return { bytes: await zip.finish(), rowCounts }
}

// The blob SDK pulls in undici, which breaks jsdom tests that import this
// service transitively — load it only when an export actually touches blobs.
async function blobStore() {
  return import('./workspace-export-blob')
}

/** Delete one export's archive by its key alone — the row may be gone. */
async function removeArchive(workspaceId: string, exportId: string) {
  const blob = await blobStore()
  await blob.deleteExportArchive(workspaceId, exportId)
  logger.info(
    `[workspace-export] removed archive of vanished export=${exportId} workspace=${workspaceId}`
  )
}

export const workspaceExportService = {
  /** OWNER only. Returns the running export instead of starting a second. */
  async requestExport(input: {
    workspaceId: string
    role: WorkspaceRole
    clerkId: string
    audit?: AuditContext
  }): Promise<{ export: WorkspaceExportView; started: boolean }> {
    assertOwner(input.role)
    const active = await repo.findActive(input.workspaceId)
    if (active) return { export: toView(active), started: false }

    const record = await repo.create(input.workspaceId, input.clerkId)
    const { startWorkspaceExport } = await import('./workspace-export-start')
    const runId = await startWorkspaceExport(record.id, input.workspaceId)
    if (!runId) {
      await repo.markFailed(record.id, 'workflow run could not be started')
      throw httpError('Could not start the export, please retry', 503)
    }
    await repo.setWorkflowRun(record.id, runId)
    await recordAuditEvent({
      workspaceId: input.workspaceId,
      action: 'data_export.requested',
      target: { type: 'data_export', id: record.id },
      context: input.audit,
    })
    logger.info(
      `[workspace-export] requested export=${record.id} workspace=${input.workspaceId} by=${input.clerkId}`
    )
    return { export: toView(record), started: true }
  },

  async listExports(
    workspaceId: string,
    role: WorkspaceRole
  ): Promise<WorkspaceExportView[]> {
    assertOwner(role)
    const rows = await repo.listRecent(workspaceId, RECENT_EXPORTS)
    return rows.map(toView)
  },

  /**
   * Workflow step: build + upload the archive, mark READY. Idempotent.
   *
   * LUM-923: the workspace may be deleted while this runs. `workspaceId`
   * comes from the workflow input so the archive can be removed even after
   * the export row went with the workspace; an upload that can no longer be
   * marked READY (row gone, or invalidated by the deletion) is deleted.
   */
  async generateArchive(
    exportId: string,
    now = new Date(),
    workspaceId?: string,
    isRunCancelled: () => Promise<boolean> = async () => false
  ): Promise<void> {
    const record = await repo.findById(exportId)
    if (!record) {
      if (workspaceId) await removeArchive(workspaceId, exportId)
      throw new Error(`export ${exportId} not found`)
    }
    if (record.status !== 'PENDING' && record.status !== 'RUNNING') return
    if (!(await repo.markRunning(exportId))) return

    const { bytes, rowCounts } = await buildWorkspaceArchive(
      record.workspaceId,
      now
    )
    const blob = await blobStore()
    // A retried step must not leave an earlier attempt's upload behind.
    await blob.deleteExportArchive(record.workspaceId, exportId)
    const blobUrl = await blob.putExportArchive(
      record.workspaceId,
      exportId,
      bytes
    )
    // LUM-1030 ruling ③: cancelling the run does not interrupt this step, so
    // an export cancelled mid-build would still turn READY with a
    // downloadable archive. Ask before it becomes visible; a cancelled export
    // ends FAILED with no archive.
    if (await isRunCancelled()) {
      await blob.deleteExportArchive(record.workspaceId, exportId)
      await repo.markFailed(exportId, EXPORT_CANCELLED_REASON)
      logger.info(`[workspace-export] cancelled export=${exportId}`)
      return
    }
    const completedAt = new Date()
    let ready = false
    try {
      ready = await repo.markReady(exportId, {
        blobUrl,
        sizeBytes: bytes.length,
        rowCounts,
        completedAt,
        expiresAt: new Date(completedAt.getTime() + EXPORT_TTL_DAYS * DAY_MS),
      })
    } finally {
      if (!ready) await blob.deleteExportArchive(record.workspaceId, exportId)
    }
    if (!ready) {
      throw new Error(`export ${exportId} was invalidated while generating`)
    }
    logger.info(
      `[workspace-export] ready export=${exportId} bytes=${bytes.length}`
    )
  },

  /** Workflow step: the download window closed — delete the archive. */
  async expireExport(exportId: string, workspaceId?: string): Promise<void> {
    const record = await repo.findById(exportId)
    if (!record) {
      // LUM-923: the row went with its workspace; the blob may not have.
      if (workspaceId) await removeArchive(workspaceId, exportId)
      return
    }
    const blob = await blobStore()
    await blob.deleteExportArchive(record.workspaceId, exportId)
    await repo.markExpired(exportId)
  },

  /** Workflow step: generation failed for good — no archive may remain. */
  async failExport(
    exportId: string,
    reason: string,
    workspaceId?: string
  ): Promise<void> {
    const record = await repo.findById(exportId)
    if (!record) {
      if (workspaceId) await removeArchive(workspaceId, exportId)
      return
    }
    const blob = await blobStore()
    await blob.deleteExportArchive(record.workspaceId, exportId)
    await repo.markFailed(exportId, reason.slice(0, 500))
    logger.warn(`[workspace-export] failed export=${exportId}: ${reason}`)
  },

  /**
   * OWNER only. Opens the archive stream and records the download. 404 for
   * another workspace's export, 410 once the window closed, 409 while it is
   * still being generated (or failed).
   */
  async openDownload(input: {
    workspaceId: string
    workspaceSlug: string
    role: WorkspaceRole
    clerkId: string
    exportId: string
    now?: Date
    audit?: AuditContext
  }): Promise<{
    stream: ReadableStream<Uint8Array>
    size: number
    filename: string
  }> {
    assertOwner(input.role)
    const now = input.now ?? new Date()
    const record = await repo.findById(input.exportId)
    if (!record || record.workspaceId !== input.workspaceId) {
      throw httpError('Export not found', 404)
    }
    if (
      record.status === 'EXPIRED' ||
      (record.expiresAt !== null && record.expiresAt <= now)
    ) {
      throw httpError('This export has expired', 410)
    }
    if (record.status !== 'READY' || !record.blobUrl) {
      throw httpError('This export is not ready', 409)
    }
    const blob = await blobStore()
    const archive = await blob.openExportArchive(record.blobUrl)
    if (!archive) throw httpError('This export has expired', 410)
    await repo.recordDownload(record.id, input.clerkId, now)
    await recordAuditEvent({
      workspaceId: input.workspaceId,
      action: 'data_export.downloaded',
      target: { type: 'data_export', id: record.id },
      context: input.audit,
    })
    logger.info(
      `[workspace-export] download export=${record.id} by=${input.clerkId}`
    )
    const day = (record.completedAt ?? record.createdAt)
      .toISOString()
      .slice(0, 10)
    return {
      stream: archive.stream,
      size: archive.size,
      filename: `lumo-${input.workspaceSlug}-export-${day}.zip`,
    }
  },
}
