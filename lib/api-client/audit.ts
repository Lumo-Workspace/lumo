import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { AuditEventPage } from '@/lib/audit/query'

/** Filter values as the settings page holds them; '' = not set. */
export type AuditEventFilterParams = Record<string, string>

/** The query string for the list / export routes, empty values dropped. */
export function auditQueryString(params: AuditEventFilterParams): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `?${s}` : ''
}

/** LUM-907: settings → Audit log. */
export const auditClient = {
  list(params: AuditEventFilterParams) {
    return apiFetch<AuditEventPage>(
      `${API.workspaces.auditEvents}${auditQueryString(params)}`
    )
  },

  /** A plain GET link: the browser downloads the CSV with the session cookie. */
  exportUrl(params: AuditEventFilterParams) {
    return `${API.workspaces.auditEventsExport}${auditQueryString(params)}`
  },
}
