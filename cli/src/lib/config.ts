import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { spawnSync } from 'child_process'

export interface Credentials {
  token: string
  apiUrl: string
  userId: string
  email: string
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  apiKeyId: string
  apiKeyName: string
  apiKeyPrefix: string
}

/**
 * LUM-1337 — the logins file: one login per Lumo server (keyed by origin), a
 * default, and which server each repository uses (keyed by the repository's
 * main work tree, so every worktree of it shares the binding). The file is
 * user-level and never committed, so nothing in a repository can point the
 * CLI's tokens or session records at a server the user did not log in to.
 */
export interface LoginStore {
  version: 2
  default: string | null
  logins: Record<string, Credentials>
  repos: Record<string, string>
}

/** Where the login used for a directory came from. */
export type LoginSource = 'env' | 'repo' | 'default'

export interface ResolvedLogin {
  creds: Credentials
  source: LoginSource
  /** The repository key the lookup used (null outside a git repo). */
  repo: string | null
  /** Why the lookup fell back to the default login, for hook.log. */
  note?: string
}

export function configDir(): string {
  return process.env.LUMO_CONFIG_DIR || path.join(os.homedir(), '.lumo')
}

export function credentialsPath(): string {
  return path.join(configDir(), 'credentials.json')
}

/** `scheme://host[:port]` — the key a login is stored under; null if unparsable. */
export function loginKey(url: string): string | null {
  try {
    return new URL(url.trim()).origin
  } catch {
    return null
  }
}

function isCredentials(v: unknown): v is Credentials {
  const c = v as Partial<Credentials> | null
  return typeof c?.token === 'string' && typeof c?.apiUrl === 'string'
}

function emptyStore(): LoginStore {
  return { version: 2, default: null, logins: {}, repos: {} }
}

/**
 * Read the logins file. A single-login file from before LUM-1337 reads as
 * that one login, made the default — upgrading logs nobody out. Unreadable
 * or malformed → no logins.
 */
export function readLoginStore(): LoginStore {
  const p = credentialsPath()
  if (!fs.existsSync(p)) return emptyStore()
  let data: unknown
  try {
    data = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return emptyStore()
  }
  if (isCredentials(data)) {
    const key = loginKey(data.apiUrl)
    if (!key) return emptyStore()
    return { version: 2, default: key, logins: { [key]: data }, repos: {} }
  }
  const raw = data as Partial<LoginStore> | null
  if (raw?.version !== 2) return emptyStore()
  const logins: Record<string, Credentials> = {}
  for (const [key, creds] of Object.entries(raw.logins ?? {})) {
    if (isCredentials(creds)) logins[key] = creds
  }
  const repos: Record<string, string> = {}
  for (const [repo, key] of Object.entries(raw.repos ?? {})) {
    if (typeof key === 'string') repos[repo] = key
  }
  const def = typeof raw.default === 'string' ? raw.default : null
  return { version: 2, default: def, logins, repos }
}

export function writeLoginStore(store: LoginStore): void {
  const dir = configDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { mode: 0o700, recursive: true })
  } else {
    try {
      fs.chmodSync(dir, 0o700)
    } catch {
      // Best-effort perms tightening; continue if filesystem doesn't support chmod
    }
  }
  const p = credentialsPath()
  fs.writeFileSync(p, JSON.stringify(store, null, 2), { mode: 0o600 })
  try {
    fs.chmodSync(p, 0o600)
  } catch {
    // Best-effort perms tightening
  }
}

/**
 * The key a repository's binding is stored under: the main work tree of the
 * git repository containing `cwd` (realpath), so its worktrees share it.
 * Null outside a git repository.
 */
export function repoKey(cwd: string): string | null {
  const res = spawnSync(
    'git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  )
  if (res.error || res.status !== 0) return null
  const common = res.stdout.trim()
  if (!common) return null
  // `<root>/.git` for a normal repo; a bare repo's common dir is itself.
  const root = path.basename(common) === '.git' ? path.dirname(common) : common
  try {
    return fs.realpathSync(root)
  } catch {
    return root
  }
}

/**
 * The login to use in `cwd`:
 *   1. `LUMO_API_URL`, when it names a server the user logged in to;
 *   2. the repository's binding;
 *   3. the default login.
 * A `LUMO_API_URL` without a matching login keeps the old behavior (the
 * caller sends the selected token there, with a host-mismatch warning). A
 * binding to a server that is no longer logged in falls back to the default,
 * with a `note`.
 */
export function resolveLogin(
  cwd: string = process.cwd(),
  store: LoginStore = readLoginStore()
): ResolvedLogin | null {
  const envKey = loginKey(process.env.LUMO_API_URL ?? '')
  const envLogin = envKey ? store.logins[envKey] : undefined
  // Skip git entirely when no repository is bound — the common case.
  const repo = Object.keys(store.repos).length > 0 ? repoKey(cwd) : null
  if (envLogin) return { creds: envLogin, source: 'env', repo }

  let note: string | undefined
  const bound = repo ? store.repos[repo] : undefined
  if (bound) {
    const creds = store.logins[bound]
    if (creds) return { creds, source: 'repo', repo }
    note = `${repo} is bound to ${bound}, which is not logged in; using the default login`
  }
  const def = store.default ? store.logins[store.default] : undefined
  if (!def) return null
  return note
    ? { creds: def, source: 'default', repo, note }
    : { creds: def, source: 'default', repo }
}

/** The credentials to use in `cwd` (see `resolveLogin`), or null if logged out. */
export function readCredentials(
  cwd: string = process.cwd(),
  opts: { onNote?: (note: string) => void } = {}
): Credentials | null {
  const login = resolveLogin(cwd)
  if (login?.note) opts.onNote?.(login.note)
  return login?.creds ?? null
}

export interface SaveLoginResult {
  key: string
  isDefault: boolean
  /** The repository now bound to this server, if the save bound one. */
  boundRepo: string | null
}

/**
 * Store a login (replacing any earlier login to the same server). The first
 * login becomes the default. With `bindCwd`, the repository containing it is
 * pointed at this server — or, when this server is the default, its binding
 * is dropped so it follows the default.
 */
export function saveLogin(
  creds: Credentials,
  opts: { bindCwd?: string } = {}
): SaveLoginResult {
  const key = loginKey(creds.apiUrl)
  if (!key) throw new Error(`Invalid API URL "${creds.apiUrl}"`)
  const store = readLoginStore()
  store.logins[key] = creds
  if (!store.default || !store.logins[store.default]) store.default = key
  const isDefault = store.default === key
  let boundRepo: string | null = null
  const repo = opts.bindCwd ? repoKey(opts.bindCwd) : null
  if (repo) {
    if (isDefault) delete store.repos[repo]
    else {
      store.repos[repo] = key
      boundRepo = repo
    }
  }
  writeLoginStore(store)
  return { key, isDefault, boundRepo }
}

/**
 * Remove the login to one server and every repository binding that pointed
 * at it. When the default goes and exactly one login remains, that one
 * becomes the default. Returns the removed login, or null if there was none.
 */
export function removeLogin(key: string): Credentials | null {
  const store = readLoginStore()
  const removed = store.logins[key]
  if (!removed) return null
  delete store.logins[key]
  for (const [repo, bound] of Object.entries(store.repos)) {
    if (bound === key) delete store.repos[repo]
  }
  if (store.default === key) {
    const rest = Object.keys(store.logins)
    store.default = rest.length === 1 ? rest[0]! : null
  }
  if (Object.keys(store.logins).length === 0) {
    fs.unlinkSync(credentialsPath())
  } else {
    writeLoginStore(store)
  }
  return removed
}
