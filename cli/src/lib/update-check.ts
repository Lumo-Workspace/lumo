import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { spawn } from 'child_process'
import { configDir } from './config'
import { maybeAutoUpdate } from './auto-update'

const CACHE_FILE = path.join(configDir(), 'update-check.json')
const CHECK_INTERVAL_MS = 1000 * 60 * 60 * 24

type Cache = { lastChecked: number; latest: string }

function readCache(): Cache | null {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Cache
    if (
      typeof parsed.lastChecked !== 'number' ||
      typeof parsed.latest !== 'string'
    )
      return null
    return parsed
  } catch {
    return null
  }
}

function writeCache(cache: Cache): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache))
  } catch {
    /* swallow — the update check is non-essential */
  }
}

// Compare two dotted version strings. Returns true iff `b` is strictly newer.
// Handles the subset of semver we actually publish: MAJOR.MINOR.PATCH with
// no pre-release tags. Unknown segments are treated as 0.
export function isNewer(current: string, candidate: string): boolean {
  const c = current.split('.').map(n => parseInt(n, 10) || 0)
  const l = candidate.split('.').map(n => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

export function fetchLatestVersion(
  name: string,
  timeoutMs = 2000
): Promise<string | null> {
  return new Promise(resolve => {
    const url = `https://registry.npmjs.org/${encodeURIComponent(name).replace(
      '%40',
      '@'
    )}/latest`
    const req = https.get(
      url,
      { headers: { Accept: 'application/json' } },
      res => {
        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume()
          return resolve(null)
        }
        let data = ''
        res.setEncoding('utf8')
        res.on('data', chunk => {
          data += chunk
        })
        res.on('end', () => {
          try {
            const json = JSON.parse(data) as { version?: string }
            resolve(typeof json.version === 'string' ? json.version : null)
          } catch {
            resolve(null)
          }
        })
      }
    )
    req.on('error', () => resolve(null))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(null)
    })
  })
}

// Read cached latest version and emit a one-line notice to stderr when a
// newer version is available. Safe to call on every CLI invocation.
export function printUpdateNoticeIfAny(name: string, current: string): void {
  const cache = readCache()
  if (!cache) return
  if (isNewer(current, cache.latest)) {
    process.stderr.write(
      `\n  ⬆ Update available: ${name} ${current} → ${cache.latest}\n    Run: lumo update\n\n`
    )
  }
}

// Spawn a detached child to refresh the cached latest version when the cache
// is older than CHECK_INTERVAL_MS. The child re-enters the CLI entrypoint via
// the `__update-check` sentinel arg and exits silently when done. Failures
// here must never affect the foreground command.
export function maybeRefreshInBackground(name: string): void {
  const cache = readCache()
  if (cache && Date.now() - cache.lastChecked < CHECK_INTERVAL_MS) return
  try {
    const child = spawn(
      process.execPath,
      [process.argv[1] || '', '__update-check', name],
      { detached: true, stdio: 'ignore' }
    )
    child.unref()
  } catch {
    /* swallow */
  }
}

// Entrypoint for the detached child. Called from index.ts when argv[2] is
// the sentinel; performs the fetch and writes the cache, then exits.
export async function runBackgroundRefresh(
  name: string,
  current: string | null = null
): Promise<void> {
  const latest = await fetchLatestVersion(name, 5000)
  if (!latest) return
  writeCache({ lastChecked: Date.now(), latest })
  // Auto-update (default on) runs here, in the detached worker only — never on
  // the foreground path. Failures fall back to the "Update available" notice.
  if (current) await maybeAutoUpdate(current, latest, isNewer)
}
