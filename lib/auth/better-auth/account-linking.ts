/**
 * LUM-1070 — explicit account-linking policy (RFC LUM-1069 §3).
 *
 * A social sign-in first looks the identity up by (provider, provider user
 * id); only an identity Lumo has never seen falls back to linking by email.
 * That fallback requires BOTH the provider to report the email as verified
 * AND the local user to have verified it — so nobody can pre-register a
 * victim's address unverified and later inherit their GitHub/Google login.
 *
 * - `trustedProviders: []` — no provider may skip the provider-side email
 *   verification check (trusting one is an account-takeover risk).
 * - `allowDifferentEmails: false` — a linked identity must carry the same
 *   email as the user.
 *
 * A refused link redirects back to the sign-in page with
 * `?error=account_not_linked`, shown as a readable message there.
 */
export const ACCOUNT_LINKING_OPTIONS = {
  enabled: true,
  trustedProviders: [] as string[],
  allowDifferentEmails: false,
}
