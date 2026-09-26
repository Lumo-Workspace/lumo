import { readCredentials, type Credentials } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

export interface WhoamiOptions {
  full?: boolean
  json?: boolean
}

/**
 * LUM-843: the default is one line — who, which workspace, which key. The
 * name/URL detail moved behind `--full`; `--json` is the machine form. The
 * token itself is never printed in any form.
 */
export function formatWhoami(
  creds: Credentials,
  opts: WhoamiOptions = {}
): string[] {
  if (opts.json) {
    return [
      JSON.stringify({
        email: creds.email,
        workspace: { slug: creds.workspaceSlug, name: creds.workspaceName },
        apiKey: { name: creds.apiKeyName, prefix: creds.apiKeyPrefix },
        apiUrl: creds.apiUrl,
      }),
    ]
  }
  if (opts.full) {
    return [
      `Logged in as ${sanitizeField(creds.email)}`,
      `  Workspace: ${sanitizeField(creds.workspaceName)} (${sanitizeField(creds.workspaceSlug)})`,
      `  Key: ${sanitizeField(creds.apiKeyName)} (${sanitizeField(creds.apiKeyPrefix)})`,
      `  API: ${sanitizeField(creds.apiUrl)}`,
    ]
  }
  return [
    `${sanitizeField(creds.email)} · workspace ${sanitizeField(creds.workspaceSlug)} · key ${sanitizeField(creds.apiKeyPrefix)}`,
  ]
}

export async function whoami(opts: WhoamiOptions = {}): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.log('Not logged in')
    console.log('Run `lumo auth login` to log in')
    return 1
  }
  for (const line of formatWhoami(creds, opts)) console.log(line)
}
