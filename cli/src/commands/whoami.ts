import { readCredentials } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

export async function whoami(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.log('Not logged in')
    console.log('Run `lumo auth login` to log in')
    return 1
  }
  console.log(`Logged in as ${sanitizeField(creds.email)}`)
  console.log(`  Workspace: ${sanitizeField(creds.workspaceName)} (${creds.workspaceSlug})`)
  console.log(`  Key: ${sanitizeField(creds.apiKeyName)} (${creds.apiKeyPrefix})`)
  console.log(`  API: ${creds.apiUrl}`)
}
