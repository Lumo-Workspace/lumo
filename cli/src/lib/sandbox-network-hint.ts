import { CODEX_SANDBOX_NETWORK_HINT } from './codex-rules'

/**
 * LUM-1054: a command run inside Codex's sandbox (no network by default) dies
 * with `could not reach Lumo API … (fetch failed)` — printed by ~90 call
 * sites. Like the LUM-843 auth hint, the entry point watches the process once
 * instead: a rejected fetch (or that message on the output), then a non-zero
 * exit while `CODEX_SANDBOX` is set, gets one paragraph naming the cause and
 * the fix appended.
 */

const UNREACHABLE_MARKER = 'could not reach Lumo API'

export interface SandboxNetworkTracker {
  /** Wrap a fetch so rejected requests (network failures) are recorded. */
  wrapFetch(fetchImpl: typeof fetch): typeof fetch
  /** Feed anything the process printed; spots the unreachable-API message. */
  noteOutput(chunk: unknown): void
  /** The hint to print before exiting with `exitCode`, or null when none is due. */
  hintFor(exitCode: number): string | null
}

export function createSandboxNetworkTracker(
  env: Record<string, string | undefined> = process.env
): SandboxNetworkTracker {
  let unreachable = false
  return {
    wrapFetch(fetchImpl) {
      const wrapped = async (
        input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1]
      ) => {
        try {
          return await fetchImpl(input, init)
        } catch (err) {
          unreachable = true
          throw err
        }
      }
      return wrapped as typeof fetch
    },
    noteOutput(chunk) {
      if (unreachable) return
      const text =
        typeof chunk === 'string'
          ? chunk
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk).toString('utf8')
            : ''
      if (text.includes(UNREACHABLE_MARKER)) unreachable = true
    },
    hintFor(exitCode) {
      if (exitCode === 0 || !unreachable || !env.CODEX_SANDBOX) return null
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
