/**
 * LUM-1110: tell the user when the CLI and the Lumo server don't fit together.
 *
 * - Every request to the Lumo API (recognised, like the LUM-843 auth hint, by
 *   its `Authorization: Bearer …`) carries `X-Lumo-Cli-Version`, so the server
 *   can refuse a known-incompatible CLI with a 426 (`lib/api/cli-version-gate.ts`).
 *   Non-Lumo requests (the npm registry check) never get it.
 * - A 426 as the last Lumo API response, followed by a non-zero exit, ends
 *   with one upgrade line naming `lumo update` — unless the command already
 *   printed it (the server's error text says it, and most commands relay
 *   that text). A later non-426 answer clears it (LUM-1116).
 * - A 404 answered with an HTML page (no API route at all, as opposed to a
 *   JSON "not found" for a missing resource) as the last Lumo API response,
 *   followed by a non-zero exit, ends
 *   with "the server may not have deployed this feature yet" instead of a
 *   bare `HTTP 404` — the case of a new command against an older server.
 *
 * Installed once by the entry point next to the auth / sandbox trackers, so
 * no call site changes. Wording lives in `errors.ts`.
 */

import { hasBearer } from './auth-failure'
import { cliUpgradeRequired, serverLacksFeature } from './errors'
import { hint } from './feedback'

/** Must stay byte-identical to the server's `CLI_VERSION_HEADER` (a test pins it). */
export const CLI_VERSION_HEADER = 'X-Lumo-Cli-Version'

const UPDATE_MARKER = 'lumo update'

export interface VersionCompatTracker {
  /** Wrap a fetch: add the version header, record 426s and route-missing 404s. */
  wrapFetch(fetchImpl: typeof fetch): typeof fetch
  /** The command being run (`task show`), for the 404 wording. */
  setCommand(path: string | null): void
  /** Feed anything the process printed; remembers whether `lumo update` was said. */
  noteOutput(chunk: unknown): void
  /** The line to print before exiting with `exitCode`, or null when none is due. */
  hintFor(exitCode: number): string | null
}

function withVersionHeader(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  version: string
): RequestInit {
  const headers = new Headers(
    init?.headers ??
      (typeof Request !== 'undefined' && input instanceof Request
        ? input.headers
        : undefined)
  )
  if (!headers.has(CLI_VERSION_HEADER)) headers.set(CLI_VERSION_HEADER, version)
  return { ...init, headers }
}

async function readMinVersion(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { minVersion?: unknown }
    return typeof body.minVersion === 'string' ? body.minVersion : null
  } catch {
    return null
  }
}

/**
 * A Lumo API request: bearer-authenticated AND aimed at an `/api/` path (the
 * npm registry and any other host never get the header or count toward a hint).
 */
function isLumoApiRequest(
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined
): boolean {
  if (!hasBearer(input, init)) return false
  const raw =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url
  try {
    return new URL(raw).pathname.startsWith('/api/')
  } catch {
    return false
  }
}

function isHtml(res: Response): boolean {
  return /text\/html/i.test(res.headers.get('content-type') ?? '')
}

export function createVersionCompatTracker(opts: {
  version: string | null
}): VersionCompatTracker {
  let tooOld = false
  let minVersion: string | null = null
  let routeMissing = false
  let updateSaid = false
  let command: string | null = null
  return {
    wrapFetch(fetchImpl) {
      const wrapped = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const lumo = isLumoApiRequest(input, init)
        const res = await fetchImpl(
          input,
          lumo && opts.version
            ? withVersionHeader(input, init, opts.version)
            : init
        )
        if (!lumo) return res
        // Only the latest Lumo response counts. A command that fell back
        // after a route-missing 404 (LUM-1093 style) and then failed for
        // another reason must not blame the server's deploy; likewise a 426
        // followed by an answer the server did accept (LUM-1116) means this
        // CLI got through, so the later failure is not "upgrade the CLI".
        tooOld = res.status === 426
        routeMissing = !tooOld && res.status === 404 && isHtml(res)
        if (tooOld) minVersion = (await readMinVersion(res)) ?? minVersion
        return res
      }
      return wrapped as typeof fetch
    },
    setCommand(path) {
      command = path
    },
    noteOutput(chunk) {
      if (updateSaid) return
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString('utf8')
            : ''
      if (text.includes(UPDATE_MARKER)) updateSaid = true
    },
    hintFor(exitCode) {
      if (exitCode === 0) return null
      if (tooOld)
        return updateSaid
          ? null
          : hint(cliUpgradeRequired(minVersion, opts.version))
      if (routeMissing) return hint(serverLacksFeature(command))
      return null
    },
  }
}

/** A commander command's path below the root program (`task testcase add`). */
export function commandPathOf(cmd: {
  name(): string
  parent: unknown
}): string | null {
  const names: string[] = []
  let node: { name(): string; parent: unknown } | null = cmd
  while (node && node.parent) {
    names.unshift(node.name())
    node = node.parent as { name(): string; parent: unknown } | null
  }
  return names.length > 0 ? names.join(' ') : null
}

/**
 * Install the tracker on the real process (fetch + stdout/stderr taps).
 * Called once from the CLI entry point, alongside the auth-failure tracker.
 */
export function installVersionCompatTracker(
  version: string | null
): VersionCompatTracker {
  const tracker = createVersionCompatTracker({ version })
  globalThis.fetch = tracker.wrapFetch(globalThis.fetch)
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream) as (...a: unknown[]) => boolean
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      tracker.noteOutput(chunk)
      return original(chunk, ...rest)
    }) as typeof stream.write
  }
  return tracker
}
