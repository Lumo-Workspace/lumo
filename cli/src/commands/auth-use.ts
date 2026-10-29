import {
  loginKey,
  readLoginStore,
  repoKey,
  withLoginStoreLock,
  writeLoginStore,
} from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

export interface AuthUseOptions {
  /** Make this login the default (repositories without a binding use it). */
  default?: boolean
  /** Drop this repository's binding, so it uses the default login. */
  unbind?: boolean
}

/**
 * LUM-1337 — `lumo auth use [url]`: point this repository (or, with
 * `--default`, every unbound one) at a server the user already logged in
 * to. Never logs in: an unknown server is refused, so a binding can only
 * name a login the user made themselves.
 */
export async function authUse(
  url: string | undefined,
  opts: AuthUseOptions = {}
): Promise<number | void> {
  const repo = repoKey(process.cwd())
  return withLoginStoreLock(() => applyAuthUse(url, opts, repo))
}

function applyAuthUse(
  url: string | undefined,
  opts: AuthUseOptions,
  repo: string | null
): number | void {
  const store = readLoginStore()

  if (opts.unbind) {
    if (url !== undefined || opts.default) {
      console.error('Error: --unbind takes no URL and no --default')
      return 2
    }
    if (!repo) {
      console.error('Error: not inside a git repository')
      return 1
    }
    const was = store.repos[repo]
    delete store.repos[repo]
    writeLoginStore(store)
    console.log(
      was
        ? `✓ ${sanitizeField(repo)} no longer bound to ${was}; it uses the default login`
        : `${sanitizeField(repo)} was not bound; it uses the default login`
    )
    return
  }

  if (url === undefined) {
    console.error(
      'Error: name the server: lumo auth use <url> (see lumo whoami)'
    )
    return 2
  }
  const key = loginKey(url)
  if (!key) {
    console.error(`Error: "${url}" is not a valid URL`)
    return 2
  }
  if (!store.logins[key]) {
    console.error(`Error: not logged in to ${key}`)
    console.error(`Hint: lumo auth login --url ${key}`)
    return 1
  }

  if (opts.default) {
    store.default = key
    writeLoginStore(store)
    console.log(`✓ Default login: ${key}`)
    return
  }
  if (!repo) {
    console.error('Error: not inside a git repository')
    console.error(
      `Hint: to use ${key} everywhere: lumo auth use ${key} --default`
    )
    return 1
  }
  if (store.default === key) delete store.repos[repo]
  else store.repos[repo] = key
  writeLoginStore(store)
  console.log(`✓ ${sanitizeField(repo)} uses ${key}`)
}
