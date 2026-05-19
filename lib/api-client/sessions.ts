import { apiFetch } from './base'

export interface RegenerateSummaryResult {
  summaryType: string
  summary: unknown
  generatedAt: string
  eventCount: number
}

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
}
