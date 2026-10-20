/**
 * Types for Sentry Internal Integration webhook payloads.
 * Reference: https://docs.sentry.io/organization/integrations/integration-platform/webhooks/
 */

export type SentryLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

export interface SentryStackFrame {
  function?: string
  filename?: string
  lineno?: number
  colno?: number
}

export interface SentrySuggestedOwner {
  owner?: {
    type?: 'user' | 'team'
    id?: string
    name?: string
    email?: string
  }
  rules?: unknown
}

export interface SentryIssueAlertPayload {
  action: string
  installation?: { uuid?: string }
  data: {
    event: {
      issue_id?: string
      issue_url?: string
      web_url?: string
      url?: string
      project_slug?: string
      title?: string
      culprit?: string
      level?: SentryLevel | string
      datetime?: string
      metadata?: {
        type?: string
        value?: string
        filename?: string
        function?: string
      }
      entries?: Array<{
        type: string
        data?: {
          values?: Array<{
            stacktrace?: { frames?: SentryStackFrame[] }
          }>
        }
      }>
      suggestedOwners?: SentrySuggestedOwner[]
      count?: number | string
      firstSeen?: string
      lastSeen?: string
    }
    triggered_rule?: string
    issue_alert?: { id?: string; title?: string }
  }
  actor?: { type?: string; id?: string; name?: string; email?: string }
}

export interface ExtractedIssueFields {
  sentryIssueId: string
  sentryProjectSlug: string
  title: string
  culprit: string | null
  /** Display level; defaults to 'info' when the payload has none. */
  level: SentryLevel
  /** The level exactly as the payload reported it, or null when absent. */
  reportedLevel: string | null
  webUrl: string
  eventCount: number | null
  firstSeen: string | null
  lastSeen: string | null
  stackFrames: SentryStackFrame[]
  triggeredRule: string | null
}
