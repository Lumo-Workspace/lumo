// Types
export type {
  InviteEmailOptions,
  InviteEmailResult,
  WorkspaceDeletionEmailOptions,
  WorkspaceDeletionEmailResult,
} from './types'

// Client
export { getResend } from './client'

// Templates
export { buildInviteEmail } from './templates/invite'
export { buildWorkspaceDeletionEmail } from './templates/workspace-deletion'
