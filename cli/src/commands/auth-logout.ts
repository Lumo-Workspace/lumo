import { loginKey, removeLogin, resolveLogin } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

export interface AuthLogoutOptions {
  /** LUM-1337: the server whose login to remove; else the one this directory uses. */
  url?: string
}

export async function authLogout(
  opts: AuthLogoutOptions = {}
): Promise<number | void> {
  let key: string | null
  if (opts.url !== undefined) {
    key = loginKey(opts.url)
    if (!key) {
      console.error(`Error: --url "${opts.url}" is not a valid URL`)
      return 1
    }
  } else {
    const login = resolveLogin()
    key = login ? loginKey(login.creds.apiUrl) : null
  }
  const removed = key ? removeLogin(key) : null
  if (!removed) {
    console.log(
      opts.url !== undefined ? `Not logged in to ${key}` : 'Not logged in'
    )
    return 0
  }
  console.log(`✓ Logged out of ${key} (${sanitizeField(removed.email)})`)
}
