/**
 * LUM-907 PR3 — changing the workspace logo. The OWNER check used to live in
 * the route (app/api/workspaces/me/logo); it is here now, next to the write
 * and its audit event.
 */
import { workspaceRepository } from '@/lib/repositories/workspace.repository'
import {
  deleteWorkspaceLogo,
  uploadWorkspaceLogo,
} from '@/lib/services/workspace-logo-blob'
import {
  recordAuditEvent,
  type AuditContext,
} from '@/lib/services/audit.service'

export const WORKSPACE_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const WORKSPACE_LOGO_MAX_BYTES = 2 * 1024 * 1024 // 2 MB

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

/** File extension for an accepted logo MIME type. */
export function logoExtension(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

export interface LogoCaller {
  workspaceId: string
  role: string
  currentLogoUrl: string | null
}

export const workspaceLogoService = {
  /**
   * Replace the workspace logo: OWNER only, PNG / JPEG / WebP up to 2 MB.
   * The old blob is deleted first, the new one uploaded, the URL persisted,
   * then the change is audited (sizes and type, not the image).
   */
  async updateLogo(
    caller: LogoCaller,
    file: unknown,
    audit?: AuditContext,
    now: Date = new Date()
  ): Promise<{ logoUrl: string }> {
    if (caller.role !== 'OWNER') {
      throw httpError(403, 'Only owners can change the logo')
    }
    if (!(file instanceof File)) throw httpError(400, 'No file provided')
    if (!WORKSPACE_LOGO_TYPES.includes(file.type)) {
      throw httpError(400, 'File must be PNG, JPEG, or WebP')
    }
    if (file.size > WORKSPACE_LOGO_MAX_BYTES) {
      throw httpError(400, 'File must be 2 MB or smaller')
    }

    if (caller.currentLogoUrl) await deleteWorkspaceLogo(caller.currentLogoUrl)
    const pathname = `workspaces/${caller.workspaceId}/logo-${now.getTime()}.${logoExtension(file.type)}`
    const logoUrl = await uploadWorkspaceLogo(pathname, file)
    await workspaceRepository.update(caller.workspaceId, { logoUrl })

    await recordAuditEvent({
      workspaceId: caller.workspaceId,
      action: 'workspace.logo_updated',
      target: { type: 'workspace', id: caller.workspaceId },
      metadata: {
        contentType: file.type,
        bytes: file.size,
        replaced: Boolean(caller.currentLogoUrl),
      },
      context: audit,
    })
    return { logoUrl }
  },
}
