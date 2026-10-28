/**
 * LUM-1332 — prints whether this self-hosted Lumo's configuration works.
 * `scripts/self-host/setup.sh` pipes this file into the running app container:
 *
 *   docker compose exec -T app node --input-type=module - --report < scripts/self-host/check-config.mjs
 *
 * It asks the app itself (POST /api/internal/self-host-check, CRON_SECRET from
 * the container's env), so every check runs with the app's real env and
 * network. Exit code: 0 all usable, 1 something failed, 3 the image predates
 * the check.
 */

const MARK = { ok: '✓', failed: '✗', skipped: '–' }

const LABEL = {
  database: 'Database',
  storage: 'File storage',
  email: 'Email',
  redis: 'Redis',
  realtime: 'Realtime',
  public_url: 'Public URL',
}

/**
 * The report lines for the checks, and the exit code they add up to.
 *
 * @param {{ id: string, status: 'ok' | 'failed' | 'skipped', detail: string, hint?: string }[]} checks
 * @returns {{ lines: string[], exitCode: number }}
 */
export function formatReport(checks) {
  const width = Math.max(...Object.values(LABEL).map(l => l.length))
  const lines = []
  for (const check of checks) {
    const label = (LABEL[check.id] ?? check.id).padEnd(width)
    lines.push(`  ${MARK[check.status] ?? '?'} ${label}  ${check.detail}`)
    if (check.hint && check.status !== 'ok') lines.push(`  ${' '.repeat(width + 4)}${check.hint}`)
  }
  const failed = checks.filter(c => c.status === 'failed').length
  lines.push('')
  lines.push(
    failed === 0
      ? 'Configuration check passed.'
      : `Configuration check: ${failed} failed. Fix .env, then re-run scripts/self-host/setup.sh.`
  )
  return { lines, exitCode: failed === 0 ? 0 : 1 }
}

async function main() {
  const port = process.env.PORT || '3000'
  let res
  try {
    res = await fetch(`http://127.0.0.1:${port}/api/internal/self-host-check`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ''}` },
      // Every check has its own 15 s limit and they run concurrently.
      signal: AbortSignal.timeout(60_000),
    })
  } catch (err) {
    console.error(`The app is not answering on port ${port}: ${err.message}`)
    console.error('See `docker compose logs app`.')
    process.exit(1)
  }
  if (res.status === 404) {
    console.error('This Lumo image has no configuration check yet; update LUMO_IMAGE to a newer release.')
    process.exit(3)
  }
  if (res.status === 401) {
    console.error('The app refused the check (HTTP 401): its CRON_SECRET differs from .env.')
    console.error('Restart it with `docker compose up -d`, then re-run scripts/self-host/setup.sh --check.')
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`Configuration check failed: HTTP ${res.status}. See \`docker compose logs app\`.`)
    process.exit(1)
  }
  let checks = null
  try {
    const body = await res.json()
    if (Array.isArray(body?.checks)) checks = body.checks
  } catch {
    // not JSON: reported below
  }
  if (!checks) {
    console.error('The app answered the check with an unexpected response; update LUMO_IMAGE and the checkout to the same release.')
    process.exit(1)
  }
  const { lines, exitCode } = formatReport(checks)
  process.stdout.write(`${lines.join('\n')}\n`)
  process.exit(exitCode)
}

if (process.argv.includes('--report')) await main()
