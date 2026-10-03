import { apiFetch } from './base'

export interface RegenerateSummaryResult {
  summaryType: string
  summary: unknown
  generatedAt: string
  eventCount: number
}

/** LUM-944: mirrors SessionRawRecordStatus (lib/services/session-raw-record.service.ts). */
export interface SessionRawRecordStatus {
  canDelete: boolean
  totalEvents: number
  deletable: number
  keptForCrossings: number
  deleted: number
  lastDeletion: { at: string; byName: string | null } | null
}

/** LUM-944: mirrors SessionRawRecordDeleteResult. */
export interface SessionRawRecordDeleteResult {
  deleted: number
  keptForCrossings: number
  done: boolean
  cursor: string | null
}

const rawRecordPath = (sessionId: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/raw-record`

export const sessionsClient = {
  /**
   * Generate (or regenerate) an AI summary of the session. Returns the new
   * summary, type, timestamp and the event count it covers.
   */
  async summarize(sessionId: string): Promise<RegenerateSummaryResult> {
    return apiFetch<RegenerateSummaryResult>(
      `/api/sessions/${sessionId}/summarize`,
      { method: 'POST' }
    )
  },

  /** LUM-944: what deleting the session's raw record would clear, and whether the viewer may. */
  async getRawRecordStatus(sessionId: string): Promise<SessionRawRecordStatus> {
    return apiFetch<SessionRawRecordStatus>(rawRecordPath(sessionId))
  },

  /**
   * LUM-944: one batched pass of deleting the session's raw record; call
   * again with `cursor` while `done` is false.
   */
  async deleteRawRecordBatch(
    sessionId: string,
    after: string | null
  ): Promise<SessionRawRecordDeleteResult> {
    return apiFetch<SessionRawRecordDeleteResult>(rawRecordPath(sessionId), {
      method: 'DELETE',
      body: { after },
    })
  },
}
