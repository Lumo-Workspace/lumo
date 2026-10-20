/**
 * LUM-1257 test fixtures: npm lockfiles and a fake OSV API, so the `--deps`
 * tests never touch the network.
 */
import type { OsvVuln } from '../src/lib/osv-advisory'

/**
 * A lockfile v3 whose `packages` are `{ "<path or name>": version }`; a key
 * without `node_modules/` is placed under it (`lodash` → `node_modules/lodash`,
 * `a/node_modules/lodash` → `node_modules/a/node_modules/lodash`).
 */
export function npmLock(pkgs: Record<string, string>): string {
  const packages: Record<string, unknown> = {
    '': { name: 'app', version: '1.0.0' },
  }
  for (const [key, version] of Object.entries(pkgs)) {
    packages[`node_modules/${key}`] = { version }
  }
  return (
    JSON.stringify(
      { name: 'app', version: '1.0.0', lockfileVersion: 3, packages },
      null,
      2
    ) + '\n'
  )
}

export interface FakeOsv {
  fetch: typeof fetch
  /** Every request body / URL the fake saw. */
  calls: { url: string; body: unknown }[]
}

/**
 * A fake api.osv.dev: `affected` maps `name@version` → advisory ids, `records`
 * holds the advisories. Anything else answers 404.
 */
export function fakeOsv(
  affected: Record<string, string[]>,
  records: OsvVuln[]
): FakeOsv {
  const calls: FakeOsv['calls'] = []
  const byId = new Map(records.map(r => [r.id, r]))
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  const impl = async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : null
    calls.push({ url, body })
    if (url.endsWith('/v1/querybatch')) {
      const queries = (
        body as {
          queries: { package: { name: string }; version: string }[]
        }
      ).queries
      return json({
        results: queries.map(q => ({
          vulns: (affected[`${q.package.name}@${q.version}`] ?? []).map(id => ({
            id,
            modified: '2026-01-01T00:00:00Z',
          })),
        })),
      })
    }
    const m = /\/v1\/vulns\/(.+)$/.exec(url)
    const rec = m ? byId.get(decodeURIComponent(m[1] ?? '')) : undefined
    return rec ? json(rec) : json({ code: 5, message: 'Bug not found.' }, 404)
  }
  return { fetch: impl as unknown as typeof fetch, calls }
}

/** A fetch that fails the way an unreachable host does. */
export const unreachableFetch = (async () => {
  throw new TypeError('fetch failed')
}) as unknown as typeof fetch

export const LODASH_VULN: OsvVuln = {
  id: 'GHSA-35jh-r3h4-6jhm',
  summary: 'Command Injection in lodash',
  aliases: ['CVE-2021-23337'],
  severity: [
    { type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H' },
  ],
  affected: [
    {
      package: { ecosystem: 'npm', name: 'lodash' },
      ranges: [
        { type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '4.17.21' }] },
      ],
    },
  ],
}

export const MAL_VULN: OsvVuln = {
  id: 'MAL-2024-1234',
  summary: 'Malicious code in evil-pkg (npm)',
  affected: [
    {
      package: { ecosystem: 'npm', name: 'evil-pkg' },
      ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }] }],
    },
  ],
}
