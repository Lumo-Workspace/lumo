import { apiFetch } from '@/lib/api-client'
import { API } from '@/app/workspace/[workspaceUrl]/constants'

// ─── Types ──────────────────────────────────────────────────────────────────

/** LUM-1341 — the workspace's Feishu / Lark install. */
export type FeishuInstallStatus =
  | { connected: false }
  | { connected: true; tenantName: string; domain: string }

/** LUM-1341 — the signed-in member's own Feishu account link. */
export interface FeishuAccountStatus {
  installed: boolean
  connected: boolean
  name: string | null
  needsReauth: boolean
}

// ─── Client ─────────────────────────────────────────────────────────────────

export const feishuApi = {
  getInstallStatus(workspaceUrl: string): Promise<FeishuInstallStatus> {
    return apiFetch<FeishuInstallStatus>(API.feishu.integration(workspaceUrl))
  },

  disconnectInstall(workspaceUrl: string): Promise<{ success: true }> {
    return apiFetch(API.feishu.integration(workspaceUrl), { method: 'DELETE' })
  },

  getAccountStatus(workspaceUrl: string): Promise<FeishuAccountStatus> {
    return apiFetch<FeishuAccountStatus>(API.feishu.account(workspaceUrl))
  },

  disconnectAccount(workspaceUrl: string): Promise<{ ok: true }> {
    return apiFetch(API.feishu.account(workspaceUrl), { method: 'DELETE' })
  },
}
