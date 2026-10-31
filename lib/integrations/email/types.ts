export interface InviteEmailOptions {
  workspaceName: string
  inviterName: string
  inviterFirstName: string
  inviterEmail: string
  inviteUrl: string
}

export interface InviteEmailResult {
  subject: string
  html: string
}

export interface WorkspaceDeletionEmailOptions {
  kind: 'scheduled' | 'cancelled'
  workspaceName: string
  actorName: string
  executeAt: Date
  settingsUrl: string
}

export interface WorkspaceDeletionEmailResult {
  subject: string
  html: string
}

export interface WaitlistApprovedEmailOptions {
  name: string | null
  signInUrl: string
}
