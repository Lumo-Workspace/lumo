/**
 * LUM-1062 — the security plugin's browser API client (moved out of
 * lib/api-client/workspaces.ts, which is core).
 */
import { apiFetch } from '@/lib/api-client/base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type {
  SecurityScanSettings,
  SecurityScanSettingsUpdate,
} from '@/lib/services/security-scan-settings.service'

export const securityScanClient = {
  /** LUM-1002: set the PR security-scan switches (`{ all }` = every one). */
  updateSecurityScan(data: SecurityScanSettingsUpdate) {
    return apiFetch<SecurityScanSettings>(API.workspaces.securityScan, {
      method: 'PATCH',
      body: data,
    })
  },
}
