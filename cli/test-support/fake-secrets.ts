/**
 * LUM-1255 — fake credentials for the local-scan tests, assembled at runtime
 * so no token-shaped literal sits in the repo (the PR scan and the session
 * boundary detector would report it).
 */

/** An AWS access key id shape: `AKIA` + 16 base32 chars. */
export function fakeAwsKeyId(seed = 'QWERTYUIOPASDFGH'): string {
  return [
    'AK',
    'IA',
    seed
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, 'Z')
      .slice(0, 16)
      .padEnd(16, 'Z'),
  ].join('')
}

/** A GitHub personal access token shape: `ghp_` + 36 alphanumerics. */
export function fakeGithubToken(): string {
  return ['gh', 'p_', 'aB3dE5gH7jK9mN1pQ3sT5vW7yZ9bC1dE3fG5'].join('')
}
