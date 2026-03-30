export const INVITE_EXPIRY_DAYS = 7

/** Returns a Date that is INVITE_EXPIRY_DAYS from now. */
export function inviteExpiresAt(): Date {
  return new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
}
