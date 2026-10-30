import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

/** LUM-1343 — what an import returns besides the new doc. */
export interface FeishuImportResponse {
  document: { id: string; slug: string; title: string }
  /** Block type names kept as links back to Feishu. */
  unsupported: string[]
  /** Images that could not be copied and link back to Feishu. */
  missingImages: number
}

/** LUM-1343 — import Feishu / Lark docs and re-sync them (one way). */
export const feishuDocsApi = {
  importDoc(url: string): Promise<FeishuImportResponse> {
    return apiFetch<FeishuImportResponse>(API.documents.importFeishu, {
      method: 'POST',
      body: { url },
    })
  },

  resyncDoc(id: string): Promise<{ document: { id: string } }> {
    return apiFetch(API.documents.syncFeishu(id), { method: 'POST' })
  },
}
