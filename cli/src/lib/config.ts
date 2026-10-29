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

/**
 * `scheme://host[:port]` — the key a login is stored under. Null when the URL
 * is unparsable or not http(s): those have an opaque origin (`"null"`), which
 * would put every such login under one key.
 */
export function loginKey(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
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

function ensureConfigDir(): void {
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
}

/** How long a writer waits for another `lumo` process's lock. */
export const LOGIN_STORE_LOCK_TIMEOUT_MS = 3_000
/** A lock older than this is left over from a crashed process. */
const LOGIN_STORE_LOCK_STALE_MS = 10_000

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run a read-modify-write of the logins file under an exclusive lock file
 * (`credentials.json.lock`), so two `lumo` processes logging in at once do
 * not overwrite each other's change. Readers take no lock: the store is
 * replaced by rename, so they always see a whole file.
 */
export function withLoginStoreLock<T>(fn: () => T): T {
  ensureConfigDir()
  const lock = `${credentialsPath()}.lock`
  const deadline = Date.now() + LOGIN_STORE_LOCK_TIMEOUT_MS
  let fd: number | null = null
  while (fd === null) {
    try {
      fd = fs.openSync(lock, 'wx', 0o600)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      try {
        if (
          Date.now() - fs.statSync(lock).mtimeMs >
          LOGIN_STORE_LOCK_STALE_MS
        ) {
          fs.rmSync(lock, { force: true })
          continue
        }
      } catch {
        continue // the holder just released it
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `the Lumo credentials file is locked by another lumo process; try again (if none is running, delete ${lock})`
        )
      }
      sleepSync(25)
    }
  }
  try {
    return fn()
  } finally {
    fs.closeSync(fd)
    fs.rmSync(lock, { force: true })
  }
}

export function writeLoginStore(store: LoginStore): void {
  ensureConfigDir()
  // Write a temp file and rename it over the store, so a concurrent reader
  // (a hook, another command) sees the old or the new file — never a torn one.
  const p = credentialsPath()
  const tmp = `${p}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 })
    try {
      fs.chmodSync(tmp, 0o600)
    } catch {
      // Best-effort perms tightening
    }
    fs.renameSync(tmp, p)
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // keep the original error
    }
    throw err
  }
}

export interface RepoLookup {
  /** The repository key, or null outside a git repository (or on `error`). */
  key: string | null
  /** Why git could not answer (not "outside a repository"), for a note. */
  error?: string
}

/**
 * The key a repository's binding is stored under: the main work tree of the
 * git repository containing `cwd` (realpath), so its worktrees share it.
 * `--absolute-git-dir` (git 2.13+) gives this work tree's git dir; a linked
 * worktree's git dir names the shared one in its `commondir` file.
 */
export function lookupRepoKey(cwd: string): RepoLookup {
  const res = spawnSync('git', ['rev-parse', '--absolute-git-dir'], {
    cwd,
    // Untranslated messages: "not a git repository" is matched below.
    env: { ...process.env, LC_ALL: 'C' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (res.error)
    return { key: null, error: `git did not run (${res.error.message})` }
  if (res.status !== 0) {
    const stderr = (res.stderr ?? '').trim()
    if (/not a git repository/i.test(stderr)) return { key: null }
    return {
      key: null,
      error: `git rev-parse failed in ${cwd}: ${stderr.split('\n')[0] || `exit ${res.status}`}`,
    }
  }
  const gitDir = res.stdout.trim()
  if (!gitDir) return { key: null }
  let common = gitDir
  try {
    const rel = fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()
    if (rel) common = path.resolve(gitDir, rel)
  } catch {
    // no commondir file: this is the main work tree's git dir
  }
  // `<root>/.git` for a normal repo; a bare repo's common dir is itself.
  const root = path.basename(common) === '.git' ? path.dirname(common) : common
  try {
    return { key: fs.realpathSync(root) }
  } catch {
    return { key: root }
  }
}

/** `lookupRepoKey(cwd).key`: null outside a git repository. */
export function repoKey(cwd: string): string | null {
  return lookupRepoKey(cwd).key
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
  const lookup: RepoLookup =
    Object.keys(store.repos).length > 0 ? lookupRepoKey(cwd) : { key: null }
  const repo = lookup.key
  if (envLogin) return { creds: envLogin, source: 'env', repo }

  let note: string | undefined = lookup.error
    ? `${lookup.error}; repository bindings ignored, using the default login`
    : undefined
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
  /** Why `bindCwd` could not be bound (git failed there), if it could not. */
  bindError?: string
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
  const lookup: RepoLookup = opts.bindCwd
    ? lookupRepoKey(opts.bindCwd)
    : { key: null }
  return withLoginStoreLock(() => {
    const store = readLoginStore()
    store.logins[key] = creds
    if (!store.default || !store.logins[store.default]) store.default = key
    const isDefault = store.default === key
    let boundRepo: string | null = null
    const repo = lookup.key
    if (repo) {
      if (isDefault) delete store.repos[repo]
      else {
        store.repos[repo] = key
        boundRepo = repo
      }
    }
    writeLoginStore(store)
    // A git failure only matters when the login would have bound the repo.
    return lookup.error && !isDefault
      ? { key, isDefault, boundRepo, bindError: lookup.error }
      : { key, isDefault, boundRepo }
  })
}

export interface RemovedLogin {
  removed: Credentials
  /** The login that became the default because the removed one was it. */
  newDefault: string | null
}

/**
 * Remove the login to one server and every repository binding that pointed
 * at it. When the default goes and other logins remain, the first of them
 * (by server URL) becomes the default, so unbound repositories stay logged
 * in. Returns null if there was no such login.
 */
export function removeLogin(key: string): RemovedLogin | null {
  return withLoginStoreLock(() => removeLoginLocked(key))
}

function removeLoginLocked(key: string): RemovedLogin | null {
  const store = readLoginStore()
  const removed = store.logins[key]
  if (!removed) return null
  delete store.logins[key]
  for (const [repo, bound] of Object.entries(store.repos)) {
    if (bound === key) delete store.repos[repo]
  }
  let newDefault: string | null = null
  if (store.default === key) {
    newDefault = Object.keys(store.logins).sort()[0] ?? null
    store.default = newDefault
  }
  if (Object.keys(store.logins).length === 0) {
    fs.rmSync(credentialsPath(), { force: true })
  } else {
    writeLoginStore(store)
  }
  return { removed, newDefault }
}
