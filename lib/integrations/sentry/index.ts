/**
 * Public API for the Sentry integration module (server-side).
 *
 * Server code should import from this barrel. Client components must instead
 * import types directly from `./types` — this barrel re-exports server-only
 * utilities (verify, etc.) that pull in node `crypto`.
 */

// Types
export type {
  SentryLevel,
  SentryStackFrame,
  SentrySuggestedOwner,
  SentryIssueAlertPayload,
  ExtractedIssueFields,
} from './types'

// Signature verification
export { verifySentrySignature } from './verify'

// Payload helpers
export {
  mapLevelToPriority,
  pickSuggestedOwnerEmails,
  extractIssueFields,
  buildTaskDescription,
} from './payload'
