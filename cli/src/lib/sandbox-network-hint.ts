import {
  CODEX_SANDBOX_NETWORK_HINT,
  codexCommandPath,
  codexSandboxedCommandHint,
  isCodexServerOnly,
} from './codex-rules'

/**
 * LUM-1054: a command run inside Codex's sandbox (no network by default) dies
 * with `could not reach Lumo API … (fetch failed)` — printed by ~90 call
 * sites. Only a request that failed the way the sandbox denies network
 * counts (see {@link isSandboxNetworkDenial}), and none once any request got
 * a response. Like the LUM-843 auth hint, the entry point watches the process once
 * instead: a rejected fetch (or that message on the output), then a non-zero
 * exit while `CODEX_SANDBOX` is set, gets one paragraph naming the cause and
 * the fix appended. A command Lumo's Codex rule leaves sandboxed on purpose
 * gets a different paragraph: approve it in Codex instead of re-running init.
 */

const UNREACHABLE_MARKER = 'could not reach Lumo API'

/**
 * How Codex's sandbox denies a request, measured with codex-cli 0.162.0
 * (`codex sandbox -- node …` on macOS seatbelt): undici rejects with
 * `TypeError: fetch failed` whose `cause.code` is `ENOTFOUND` (getaddrinfo is
 * blocked) or `EPERM` (connect to an IP / localhost is blocked). `EACCES` /
 * `EAI_AGAIN` are the same denial on other platforms / resolvers. Anything
 * else — our own timeouts (`TimeoutError` / `AbortError`), an unreachable
 * local server (`ECONNREFUSED`, which the sandbox never produces: it answers
 * `EPERM` first), TLS or `bad port` errors — is not the sandbox, so no hint.
 */
export const SANDBOX_DENIAL_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPERM',
  'EACCES',
])

/** Whether a rejected fetch looks like the sandbox's network denial. */
export function isSandboxNetworkDenial(err: unknown): boolean {
  if (!(err instanceof TypeError) || err.message !== 'fetch failed')
    return false
  const code = (err as { cause?: { code?: unknown } }).cause?.code
  return typeof code === 'string' && SANDBOX_DENIAL_CODES.has(code)
}

export interface SandboxNetworkTracker {
  /** Wrap a fetch so rejected requests (network failures) are recorded. */
  wrapFetch(fetchImpl: typeof fetch): typeof fetch
  /** Feed anything the process printed; spots the unreachable-API message. */
  noteOutput(chunk: unknown): void
  /** The hint to print before exiting with `exitCode`, or null when none is due. */
  hintFor(exitCode: number): string | null
}

export function createSandboxNetworkTracker(
  env: Record<string, string | undefined> = process.env,
  args: readonly string[] = process.argv.slice(2)
): SandboxNetworkTracker {
  // `denied`: a request failed the way the sandbox denies network.
  // `reached`: some request got a response — then the network works and a
  // non-zero exit is about something else, so no hint even after an earlier
  // denial (in the sandbox *every* request is denied, so one success rules
  // it out).
  let denied = false
  let reached = false
  return {
    wrapFetch(fetchImpl) {
      const wrapped = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        try {
          const res = await fetchImpl(input, init)
          reached = true
          return res
        } catch (err) {
          if (isSandboxNetworkDenial(err)) denied = true
          throw err
        }
      }
      return wrapped as typeof fetch
    },
    noteOutput(chunk) {
      if (denied) return
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString('utf8')
            : ''
      // Only the printed form of a denial (`… (fetch failed)`), not a
      // timeout or an HTTP error reported with the same prefix.
      if (text.includes(UNREACHABLE_MARKER) && text.includes('fetch failed'))
        denied = true
    },
    hintFor(exitCode) {
      if (exitCode === 0 || !denied || reached || !env.CODEX_SANDBOX)
        return null
      const commandPath = codexCommandPath(args)
      if (commandPath !== null && !isCodexServerOnly(args))
        return codexSandboxedCommandHint(commandPath)
      return CODEX_SANDBOX_NETWORK_HINT
    },
  }
}

/**
 * Install the tracker on the real process (fetch + stdout/stderr taps).
 * Called once from the CLI entry point, alongside the auth-failure tracker.
 */
export function installSandboxNetworkTracker(): SandboxNetworkTracker {
  const tracker = createSandboxNetworkTracker()
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
