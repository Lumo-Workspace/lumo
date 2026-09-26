/**
 * LUM-843: one auth-failure remediation line for every command.
 *
 * About 90 commands handle a 401 themselves ("API key invalid or revoked. Run
 * `lumo auth login`."), but ~30 others print only `HTTP 401` — so agents
 * probed with `lumo whoami` before every call instead of trusting the error.
 * Rather than patch each call site (and every future one), the entry point
 * watches the process once: a 401 answered to a bearer-authenticated request,
 * followed by a non-zero exit that never mentioned `lumo auth login`, gets the
 * remediation line appended. Commands that already say it are left alone.
 */

export const AUTH_LOGIN_HINT =
  'Hint: the Lumo API rejected the API key (HTTP 401) — run `lumo auth login` to log in again.'

const REMEDIATION_MARKER = 'lumo auth login'

export interface AuthFailureTracker {
  /** Wrap a fetch so 401s on bearer-authenticated requests are recorded. */
  wrapFetch(fetchImpl: typeof fetch): typeof fetch
  /** Feed anything the process printed; remembers whether the remediation was already said. */
  noteOutput(chunk: unknown): void
  /** The line to print before exiting with `exitCode`, or null when none is due. */
  hintFor(exitCode: number): string | null
}

function hasBearer(input: unknown, init?: RequestInit): boolean {
  const headerSources: unknown[] = [init?.headers]
  if (typeof Request !== 'undefined' && input instanceof Request)
    headerSources.push(input.headers)
  for (const h of headerSources) {
    if (!h) continue
    let value: string | null | undefined
    if (typeof Headers !== 'undefined' && h instanceof Headers) {
      value = h.get('authorization')
    } else if (Array.isArray(h)) {
      value = h.find(([k]) => String(k).toLowerCase() === 'authorization')?.[1]
    } else {
      const entry = Object.entries(h as Record<string, string>).find(
        ([k]) => k.toLowerCase() === 'authorization'
      )
      value = entry?.[1]
    }
    if (typeof value === 'string' && /^Bearer\s/i.test(value)) return true
  }
  return false
}

export function createAuthFailureTracker(): AuthFailureTracker {
  let saw401 = false
  let remediationSaid = false
  return {
    wrapFetch(fetchImpl) {
      const wrapped = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        const res = await fetchImpl(input, init)
        if (res.status === 401 && hasBearer(input, init)) saw401 = true
        return res
      }
      return wrapped as typeof fetch
    },
    noteOutput(chunk) {
      if (remediationSaid) return
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString('utf8')
            : ''
      if (text.includes(REMEDIATION_MARKER)) remediationSaid = true
    },
    hintFor(exitCode) {
      if (exitCode === 0 || !saw401 || remediationSaid) return null
      return AUTH_LOGIN_HINT
    },
  }
}

/**
 * Install the tracker on the real process: wraps the global fetch and taps
 * stdout/stderr writes. Called once from the CLI entry point (never from
 * hooks' import path — hooks exit 0 and stay silent anyway).
 */
export function installAuthFailureTracker(): AuthFailureTracker {
  const tracker = createAuthFailureTracker()
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
