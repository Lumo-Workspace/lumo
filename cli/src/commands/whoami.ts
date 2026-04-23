import { readCredentials } from '../lib/config'

export async function whoami(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.log('Not logged in')
    console.log('Run `lumo auth login` to log in')
    return 1
  }
  console.log(`Logged in as ${creds.email}`)
  console.log(`  Workspace: ${creds.workspaceName} (${creds.workspaceSlug})`)
  console.log(`  Key: ${creds.apiKeyName} (${creds.apiKeyPrefix})`)
  console.log(`  API: ${creds.apiUrl}`)
}
