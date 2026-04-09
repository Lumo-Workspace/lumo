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
