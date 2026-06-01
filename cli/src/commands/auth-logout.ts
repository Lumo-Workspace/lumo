import { readCredentials, deleteCredentials } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

export async function authLogout(): Promise<number | void> {
  const creds = readCredentials()
  if (!creds) {
    console.log('Not logged in')
    return 0
  }
  const email = creds.email
  deleteCredentials()
  console.log(`✓ Logged out (${sanitizeField(email)})`)
}
