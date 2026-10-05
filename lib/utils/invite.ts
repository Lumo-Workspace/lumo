export const INVITE_EXPIRY_DAYS = 7

/** Returns a Date that is INVITE_EXPIRY_DAYS from now. */
export function inviteExpiresAt(): Date {
  return new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
}

/**
 * An email address masked for display to someone who may not own it (the
 * public invite page): the first character of the local part, `***`, then the
 * domain — `alice@acme.com` → `a***@acme.com`. Anything without a usable
 * `local@domain` shape is masked completely.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  const local = at > 0 ? email.slice(0, at) : ''
  const domain = at > 0 ? email.slice(at + 1) : ''
  if (!local || !domain) return '***'
  return `${local[0]}***@${domain}`
}

/** Error code the accept route returns when the signed-in account is not the invited one. */
export const INVITE_EMAIL_MISMATCH = 'INVITE_EMAIL_MISMATCH'
