// Types
export type {
  InviteEmailOptions,
  InviteEmailResult,
  WorkspaceDeletionEmailOptions,
  WorkspaceDeletionEmailResult,
} from './types'

// Client
export {
  sendEmail,
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
export { buildWorkspaceDeletionEmail } from './templates/workspace-deletion'
export {
  buildSubprocessorChangeEmail,
  type SubprocessorChangeEmailOptions,
  type SubprocessorChangeEmailResult,
} from './templates/subprocessor-change'
