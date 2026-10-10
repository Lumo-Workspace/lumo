/**
 * @jest-environment node
 *
 * LUM-886 / LUM-892 — plugin half of
 * __tests__/lib/integrations/github/token-permissions.test.ts (split in
 * LUM-1065 when the service moved into ee/security/): the security plugin's
 * PR review service mints through `getRepoToken` with the narrowed
 * permission set its endpoints need — the scanning-off notice, then the
 * review sync, both pull-request writes.
 */
import fs from 'fs'
import path from 'path'

const SERVICE_SETS: Record<string, string[]> = {
  'ee/security/services/security-pr-review.service.ts': [
    'pullRequestWrite',
    'pullRequestWrite',
  ],
}

it('mints with the narrowed permission set: security plugin services (source table)', () => {
  const root = path.resolve(__dirname, '../../../../../..')
  for (const [file, sets] of Object.entries(SERVICE_SETS)) {
    const src = fs.readFileSync(path.join(root, file), 'utf8')
    const calls = [
      ...src.matchAll(/getRepoToken\(([^()]*?)\)(?:\.catch)?/g),
    ].map(m => m[1] ?? '')
    const named = calls.map(
      args => /REPO_TOKEN_PERMISSIONS\.(\w+)/.exec(args)?.[1] ?? 'NONE'
    )
    expect({ file, sets: named }).toEqual({ file, sets })
  }
})
