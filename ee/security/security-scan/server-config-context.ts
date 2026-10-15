/**
 * LUM-1208 — server config files the PR does NOT change, as read-only context
 * for the AI review, when the PR changes how a server is started.
 *
 * The review reads the changed files only. A misconfiguration that a change
 * puts into effect often lives in a file next to it that the PR never
 * touches: on the LUM-1158 benchmark (oss-38) a PR added `cd frontend &&
 * trunk serve` to a Makefile while `frontend/Trunk.toml` binds 0.0.0.0, so
 * the model never saw the bind address. This module finds those files:
 *
 *   · `planServerConfigContext` — PURE: which changed files start or
 *     configure a server (Makefile / justfile / Procfile / shell targets,
 *     package.json dev / start / serve scripts, Dockerfile CMD / EXPOSE,
 *     compose ports / command, framework entrypoints that start listening),
 *     the directories those lines run in (`cd x`, `-C x`, `--prefix x`, …,
 *     then the file's own directory) and the config files they name.
 *   · `selectServerConfigFiles` — PURE: from those directories' listings,
 *     only known server config names (`Trunk.toml`, `vite.config.*`,
 *     `docker-compose*.yml`, `nginx*.conf`, `.env.example`, …), never a real
 *     `.env`, a key / certificate, or a secret / credential / token file,
 *     never a file the PR changes (the diff already has it), at most 4.
 *   · `packServerConfig` — PURE: ≤ 4k chars per file (cut at a line),
 *     ≤ 8k in all, skip-and-continue like `packReviewContext`.
 *   · `loadServerConfigContext` — lists and reads through injected readers,
 *     masks every file with `redactForInjection` BEFORE packing (the same
 *     mask as the review's file context; it keeps `0.0.0.0` readable), and
 *     degrades to no config context on any failure or timeout.
 *
 * Findings stay on ADDED lines: the prompt asks the model to report a risky
 * setting on the added line that starts or configures the server, naming the
 * config file in the detail — so it posts inline like any other finding, and
 * nothing is ever placed on a line outside the diff.
 */
import { redactForInjection } from '@/lib/security-scan/scan-secrets'

/** Total chars of server config the review gets. */
export const SERVER_CONFIG_MAX_CHARS = 8_000
/** One config file's share; a longer file is cut at a line. */
export const SERVER_CONFIG_MAX_FILE_CHARS = 4_000
/** Config files per review. */
export const SERVER_CONFIG_MAX_FILES = 4
/** Directories listed per review (one contents call each). */
export const SERVER_CONFIG_MAX_DIRS = 4
/** Wall-clock budget for the listings and reads together. */
export const SERVER_CONFIG_TIMEOUT_MS = 8_000

export interface ServerConfigPlan {
  /** Changed files whose added lines start or configure a server, diff order. */
  triggers: string[]
  /** Directories to list ('' = repository root), most specific first. */
  dirs: string[]
  /** Config files the added lines name explicitly (`nginx -c x.conf`). */
  refs: string[]
}

export interface LoadedServerConfig {
  /** What goes in the prompt's config block; '' when nothing was found. */
  text: string
  /** Paths packed, in prompt order. */
  included: string[]
  /** Why there is no config context after a failure; null otherwise. */
  error: string | null
}

const EMPTY_PLAN: ServerConfigPlan = { triggers: [], dirs: [], refs: [] }

// ── which changed files start a server ─────────────────────────────────────

const LAUNCHER_FILE =
  /(^|\/)(GNUmakefile|[Mm]akefile|[^/]+\.mk|[Jj]ustfile|Taskfile\.ya?ml|Procfile(\.[^/]+)?|[^/]+\.sh)$/
const PACKAGE_JSON = /(^|\/)package\.json$/
const DOCKERFILE = /(^|\/)([^/]+\.)?[Dd]ockerfile([.-][^/]+)?$/
const COMPOSE_FILE = /(^|\/)(docker-)?compose([.-][^/]*)?\.ya?ml$/
const ENTRYPOINT_FILE = /\.(m?[jt]sx?|cjs|py|go|rs|rb|java|kt|php)$/

/** A command in a Makefile / justfile / Procfile / script that runs a server. */
const SERVER_COMMAND =
  /\b(serve|runserver|uvicorn|gunicorn|hypercorn|daphne|waitress-serve|flask\s+run|rails\s+s(erver)?|php\s+-S|http\.server|http-server|live-server|nginx|caddy|httpd|next\s+(dev|start)|nuxt\s+(dev|start)|vite|webpack-dev-server|nodemon|pm2\s+start|(npm|yarn|pnpm|bun)\s+(run\s+)?(dev|start|serve|preview)|docker(-|\s+)compose\s+up)\b/
/** A package.json script whose name says it starts something: `"dev": "…"`. */
const PACKAGE_SCRIPT = /"[\w:.-]*(dev|start|serve|preview)[\w:.-]*"\s*:\s*"/
const DOCKER_START = /^\s*(CMD|ENTRYPOINT|EXPOSE)\b/i
const COMPOSE_START =
  /^\s*(ports|command|entrypoint|expose)\s*:|^\s*image\s*:\s*\S*(nginx|caddy|httpd|traefik)/
/** Framework code that starts listening. */
const ENTRYPOINT_START =
  /\.listen\(|\bapp\.run\(|\buvicorn\.run\(|\bListenAndServe(TLS)?\(|\bTcpListener::bind\(|\bHttpServer::new\(|\bcreateServer\(|\b(Bun|Deno)\.serve\(/

function startsServer(path: string, line: string): boolean {
  if (PACKAGE_JSON.test(path)) return PACKAGE_SCRIPT.test(line)
  if (DOCKERFILE.test(path)) return DOCKER_START.test(line)
  if (COMPOSE_FILE.test(path)) return COMPOSE_START.test(line)
  if (LAUNCHER_FILE.test(path)) return SERVER_COMMAND.test(line)
  if (ENTRYPOINT_FILE.test(path)) return ENTRYPOINT_START.test(line)
  return false
}

/** Added lines per changed file, in diff order. */
function addedLinesByFile(diff: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).trim()
      if (target.startsWith('b/')) {
        const path = target.slice(2)
        current = out.get(path) ?? []
        out.set(path, current)
      } else current = null
      continue
    }
    if (line.startsWith('diff --git ')) {
      current = null
      continue
    }
    if (current && line.startsWith('+')) current.push(line.slice(1))
  }
  return out
}

// ── paths named by the added lines ─────────────────────────────────────────

function dirname(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * `rel` resolved against `base` inside the repository, or null when it is
 * absolute, home-relative, still holds a variable, or climbs out of the
 * repository root.
 */
function resolveInRepo(base: string, rel: string): string | null {
  let p = rel.replace(/^["']|["']$/g, '')
  // Leading build variables name the project root: `$(PROJECT_DIR)/frontend`.
  for (;;) {
    const stripped = p.replace(/^(\$\([^)]*\)|\$\{[^}]*\}|\$\w+)\/?/, '')
    if (stripped === p) break
    p = stripped
  }
  if (p === '' || p.startsWith('/') || p.startsWith('~') || p.includes('$'))
    return null
  const parts = base === '' ? [] : base.split('/')
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  return parts.join('/')
}

/** Directory flags whose value is where the command runs. */
const ARG_VALUE = String.raw`("[^"]+"|'[^']+'|(?:\$\([^)]*\)|\$\{[^}]*\}|[^\s;&|()])+)`
const DIR_ARG = new RegExp(
  String.raw`(?:\bcd|\s-C|--prefix|--cwd|--dir|--root)[\s=]+` + ARG_VALUE,
  'g'
)
const MANIFEST_ARG = new RegExp(
  String.raw`--manifest-path[\s=]+` + ARG_VALUE,
  'g'
)
const PATH_TOKEN = /(?:^|[\s"'=(,[])((?:\.{0,2}\/)?[\w.-]+(?:\/[\w.-]+)*)/g

function namedDirs(dir: string, line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(DIR_ARG)) {
    const r = resolveInRepo(dir, m[1]!)
    if (r !== null) out.push(r)
  }
  for (const m of line.matchAll(MANIFEST_ARG)) {
    const r = resolveInRepo(dir, m[1]!)
    if (r !== null) out.push(dirname(r))
  }
  return out
}

function namedConfigFiles(dir: string, line: string): string[] {
  const out: string[] = []
  for (const m of line.matchAll(PATH_TOKEN)) {
    const token = m[1]!
    if (!isServerConfigName(basename(token))) continue
    const r = resolveInRepo(dir, token)
    if (r !== null) out.push(r)
  }
  return out
}

/** PURE — which changed files start a server, and where their config lives. */
export function planServerConfigContext(diff: string): ServerConfigPlan {
  if (diff.trim() === '') return EMPTY_PLAN
  const triggers: string[] = []
  const dirs: string[] = []
  const refs: string[] = []
  const push = (into: string[], v: string) => {
    if (!into.includes(v)) into.push(v)
  }
  for (const [path, added] of addedLinesByFile(diff)) {
    const starting = added.filter(line => startsServer(path, line))
    if (starting.length === 0) continue
    triggers.push(path)
    const own = dirname(path)
    // Launcher files run their commands from the lines around the start
    // command too (`cd frontend && \` on the line before), so every added
    // line of a triggered file is read for directories and config names.
    for (const line of added) {
      for (const d of namedDirs(own, line)) push(dirs, d)
      for (const f of namedConfigFiles(own, line)) push(refs, f)
    }
    push(dirs, own)
  }
  return { triggers, dirs: dirs.slice(0, SERVER_CONFIG_MAX_DIRS), refs }
}

// ── which files are server config, and which are never read ────────────────

const CONFIG_NAMES: readonly RegExp[] = [
  /^(vite|next|nuxt|astro|svelte|remix|webpack|vue|rsbuild|rspack|angular)\.config(\.[\w-]+)?\.(m?[jt]s|cjs|json)$/,
  /^webpack\.(dev|prod|common)\.(m?[jt]s|cjs)$/,
  /^(Trunk|Rocket|fly|wrangler|netlify|config|server|settings|app)\.toml$/,
  /^(docker-)?compose([.-][\w.-]+)?\.ya?ml$/,
  /^nginx([.-][\w.-]+)?\.conf$/,
  /\.nginx(\.conf)?$/,
  /^(Caddyfile|httpd\.conf|apache2?\.conf|haproxy\.cfg|supervisord\.conf|traefik\.ya?ml)$/,
  /^\.env\.(example|sample|template|dist)$/,
  /^(example|sample)\.env$/,
  /^settings\.py$/,
  /^(gunicorn|uvicorn|hypercorn)(\.conf)?\.py$/,
  /^application(-[\w]+)?\.(ya?ml|properties)$/,
  /^appsettings(\.[\w]+)?\.json$/,
  /^(vercel|firebase|serve)\.json$/,
  /^(config|server|settings|app)\.ya?ml$/,
]

/** PURE — a file name (no directory) that configures a server. */
export function isServerConfigName(name: string): boolean {
  return CONFIG_NAMES.some(re => re.test(name))
}

const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist)$/
const SECRET_EXT = /\.(pem|key|p12|pfx|jks|keystore|crt|cer|der|asc|gpg)$/i
const SECRET_WORD = /key|secret|credential|password|passwd|token/i
const SSH_KEY = /^id_(rsa|dsa|ecdsa|ed25519)/

/**
 * PURE — never read: a real `.env` (only templates are config), keys and
 * certificates, and any path segment that names a secret.
 */
export function isSecretLikePath(path: string): boolean {
  const name = basename(path)
  if (name === '.env' || (name.startsWith('.env.') && !ENV_TEMPLATE.test(name)))
    return true
  if (SECRET_EXT.test(name) || SSH_KEY.test(name)) return true
  return path.split('/').some(seg => SECRET_WORD.test(seg))
}

/**
 * PURE — the config files to read: the explicitly named ones first, then each
 * planned directory's config files (by path), skipping changed and secret
 * files, at most SERVER_CONFIG_MAX_FILES. `listing` maps a directory to the
 * paths of its entries.
 */
export function selectServerConfigFiles(
  plan: ServerConfigPlan,
  listing: Readonly<Record<string, readonly string[]>>,
  changed: ReadonlySet<string>
): string[] {
  const picked: string[] = []
  const take = (p: string) => {
    if (picked.length >= SERVER_CONFIG_MAX_FILES || picked.includes(p)) return
    if (changed.has(p) || isSecretLikePath(p)) return
    if (!isServerConfigName(basename(p))) return
    picked.push(p)
  }
  for (const ref of plan.refs) take(ref)
  for (const dir of plan.dirs) {
    const entries = [...(listing[dir] ?? [])]
      .filter(p => dirname(p) === dir)
      .sort()
    for (const p of entries) take(p)
  }
  return picked
}

// ── packing ────────────────────────────────────────────────────────────────

export interface ServerConfigFile {
  path: string
  body: string
}

const TRUNCATED = '\n… (truncated)'

function cutAtLine(body: string, max: number): string {
  if (body.length <= max) return body
  const room = max - TRUNCATED.length
  const head = body.slice(0, room)
  const nl = head.lastIndexOf('\n')
  return `${nl > 0 ? head.slice(0, nl) : head}${TRUNCATED}`
}

/** PURE — pack files in order under min(maxChars, SERVER_CONFIG_MAX_CHARS). */
export function packServerConfig(
  files: readonly ServerConfigFile[],
  maxChars: number = SERVER_CONFIG_MAX_CHARS
): { text: string; included: string[] } {
  const cap = Math.min(maxChars, SERVER_CONFIG_MAX_CHARS)
  let text = ''
  const included: string[] = []
  for (const f of files) {
    if (f.body.trim() === '' || f.body.includes('\u0000')) continue
    const block = `=== ${f.path} ===\n${cutAtLine(f.body, SERVER_CONFIG_MAX_FILE_CHARS)}\n`
    if (text.length + block.length > cap) continue
    text += block
    included.push(f.path)
  }
  return { text, included }
}

// ── loading ────────────────────────────────────────────────────────────────

const NONE = (error: string | null): LoadedServerConfig => ({
  text: '',
  included: [],
  error,
})

/**
 * List the planned directories, read the selected config files, mask them,
 * pack them. `listDir` returns the paths of a directory's files ([] when it
 * does not exist); `readFile` null for a missing file. Any throw, or running
 * past `timeoutMs`, gives NO config context: the review runs without it.
 */
export async function loadServerConfigContext(opts: {
  plan: ServerConfigPlan
  /** Paths the PR changes (never re-sent as config). */
  changedPaths: readonly string[]
  listDir: (dir: string, signal: AbortSignal) => Promise<string[]>
  readFile: (path: string, signal: AbortSignal) => Promise<string | null>
  maxChars?: number
  timeoutMs?: number
}): Promise<LoadedServerConfig> {
  const { plan } = opts
  if (plan.triggers.length === 0) return NONE(null)
  if ((opts.maxChars ?? SERVER_CONFIG_MAX_CHARS) <= 0) return NONE(null)
  const abort = new AbortController()
  const work = async (): Promise<LoadedServerConfig> => {
    const listed = await Promise.all(
      plan.dirs.map(
        async d => [d, await opts.listDir(d, abort.signal)] as const
      )
    )
    const picked = selectServerConfigFiles(
      plan,
      Object.fromEntries(listed),
      new Set(opts.changedPaths)
    )
    const bodies = await Promise.all(
      picked.map(async path => ({
        path,
        body: await opts.readFile(path, abort.signal),
      }))
    )
    const files: ServerConfigFile[] = []
    for (const f of bodies)
      if (f.body !== null)
        // Masked before packing, so the caps hold for what is sent.
        files.push({ path: f.path, body: redactForInjection(f.body).text })
    return { ...packServerConfig(files, opts.maxChars), error: null }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(
      () => resolve('timeout'),
      opts.timeoutMs ?? SERVER_CONFIG_TIMEOUT_MS
    )
  })
  try {
    const outcome = await Promise.race([work(), timeout])
    if (outcome === 'timeout') {
      abort.abort()
      return NONE('timed out reading server config files')
    }
    return outcome
  } catch (error) {
    abort.abort()
    return NONE(error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
}
