import { NextRequest, NextResponse } from 'next/server'

/**
 * LUM-1110 — refuse API calls from a Lumo CLI the server knows it cannot
 * serve, with a structured 426 the CLI renders as "run `lumo update`".
 *
 * Every CLI request carries `X-Lumo-Cli-Version` (added once, by the fetch
 * wrapper in `cli/src/lib/version-compat.ts`). The header is a compatibility
 * signal only: it never feeds authentication or authorization, and it is never
 * logged. Requests without it — browsers, MCP clients, CLIs that predate the
 * header — are unknown and always let through, as is a value that is not a
 * plain `MAJOR.MINOR.PATCH`. This is not API version negotiation: routes keep
 * their meaning; the gate only stops a known-incompatible CLI early.
 */

/** Must stay byte-identical to `CLI_VERSION_HEADER` in the CLI (a test pins it). */
export const CLI_VERSION_HEADER = 'X-Lumo-Cli-Version'

/** `code` of the 426 body; the CLI keys its upgrade hint on it. */
export const CLI_VERSION_UNSUPPORTED_CODE = 'CLI_VERSION_UNSUPPORTED'

/**
 * Oldest CLI this server still serves, or null for "no known incompatibility".
 * Raise it when a deploy breaks an older CLI (CLIs released before LUM-1110
 * never send the header, so a floor never bites them). `LUMO_MIN_CLI_VERSION`
 * overrides it per deployment.
 */
export const MIN_SUPPORTED_CLI_VERSION: string | null = null

const VERSION_RE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/

/** `[major, minor, patch]`, or null when `value` is not a plain version. */
export function parseCliVersion(
  value: string | null | undefined
): [number, number, number] | null {
  const m = VERSION_RE.exec((value ?? '').trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function isOlder(
  a: [number, number, number],
  b: [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!
  }
  return false
}

/** The floor in force: a valid `LUMO_MIN_CLI_VERSION`, else the constant. */
export function resolveMinCliVersion(
  env: Record<string, string | undefined> = process.env
): string | null {
  const override = env.LUMO_MIN_CLI_VERSION?.trim()
  if (override && parseCliVersion(override)) return override
  return MIN_SUPPORTED_CLI_VERSION
}

/**
 * A 426 response when `request` is an API call from a CLI older than
 * `minVersion`; null (let it through) in every other case.
 */
export function cliVersionDenied(
  request: NextRequest,
  minVersion: string | null = resolveMinCliVersion()
): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/api/')) return null
  const floor = parseCliVersion(minVersion)
  if (!floor) return null
  const sent = parseCliVersion(request.headers.get(CLI_VERSION_HEADER))
  if (!sent || !isOlder(sent, floor)) return null
  const cliVersion = sent.join('.')
  const min = floor.join('.')
  return NextResponse.json(
    {
      error: `Lumo CLI ${cliVersion} is no longer supported by this server (minimum ${min}). Run \`lumo update\` to upgrade.`,
      code: CLI_VERSION_UNSUPPORTED_CODE,
      minVersion: min,
      cliVersion,
    },
    { status: 426 }
  )
}
