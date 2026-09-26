/**
 * @jest-environment node
 */
import { formatWhoami } from '@/cli/src/commands/whoami'
import type { Credentials } from '@/cli/src/lib/config'

const creds: Credentials = {
  token: 'lum_SECRET_TOKEN_VALUE',
  apiUrl: 'https://www.uselumo.ai',
  userId: 'u1',
  email: 'cli@uselumo.ai',
  workspaceId: 'w1',
  workspaceSlug: 'lumo',
  workspaceName: 'Lumo',
  apiKeyId: 'k1',
  apiKeyName: 'Claude Code',
  apiKeyPrefix: 'lum_68d4',
}

describe('whoami output', () => {
  it('is one line by default with email, workspace slug and key prefix', () => {
    const lines = formatWhoami(creds)
    expect(lines).toEqual(['cli@uselumo.ai · workspace lumo · key lum_68d4'])
  })

  it('keeps the detailed four-line form behind --full', () => {
    expect(formatWhoami(creds, { full: true })).toEqual([
      'Logged in as cli@uselumo.ai',
      '  Workspace: Lumo (lumo)',
      '  Key: Claude Code (lum_68d4)',
      '  API: https://www.uselumo.ai',
    ])
  })

  it('emits JSON behind --json', () => {
    const [line] = formatWhoami(creds, { json: true })
    expect(JSON.parse(line as string)).toEqual({
      email: 'cli@uselumo.ai',
      workspace: { slug: 'lumo', name: 'Lumo' },
      apiKey: { name: 'Claude Code', prefix: 'lum_68d4' },
      apiUrl: 'https://www.uselumo.ai',
    })
  })

  it('never prints the token in any form', () => {
    for (const opts of [{}, { full: true }, { json: true }]) {
      expect(formatWhoami(creds, opts).join('\n')).not.toContain('SECRET')
    }
  })
})
