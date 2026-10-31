// Types
export type {
  InviteEmailOptions,
  InviteEmailResult,
  WaitlistApprovedEmailOptions,
  WorkspaceDeletionEmailOptions,
  WorkspaceDeletionEmailResult,
} from './types'

// Client
export {
  sendEmail,
  isEmailDelivered,
  EMAIL_CLAIM_STALE_MS,
  resolveEmailTransport,
  resolveEmailFrom,
  DEFAULT_EMAIL_FROM,
  type EmailMessage,
  type EmailTransportKind,
  type SendEmailOptions,
  type SendEmailResult,
} from './client'

// Templates
export { buildInviteEmail } from './templates/invite'
export { buildWaitlistApprovedEmail } from './templates/waitlist-approved'
export { buildWorkspaceDeletionEmail } from './templates/workspace-deletion'
export {
  buildSubprocessorChangeEmail,
  type SubprocessorChangeEmailOptions,
  type SubprocessorChangeEmailResult,
} from './templates/subprocessor-change'
