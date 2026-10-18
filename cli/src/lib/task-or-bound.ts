import { readCredentials } from './config'
import { resolveAuthedApiUrl } from './api'
import { EXIT_USAGE } from './exit-codes'
import { resolveBoundTaskIdentifier } from './resolve-bound-task'
import { errNotLoggedIn } from './errors'

/**
 * LUM-1233 3j (AR-2): the task a command acts on — the one named, else the
 * task this session is bound to. Neither → a usage error naming both ways
 * (exit 2). Errors are printed; the result is then the exit code.
 */
export async function taskOrBound(
  explicit: string | undefined,
  usage: string
): Promise<string | number> {
  const named = explicit?.trim()
  if (named) return named
  const creds = readCredentials()
  if (!creds) {
    console.error(errNotLoggedIn())
    return 1
  }
  const bound = await resolveBoundTaskIdentifier(
    resolveAuthedApiUrl(creds.apiUrl),
    creds.token
  )
  if (bound) return bound
  console.error(
    `Error: no task — pass it (${usage}) or run inside a session bound with \`lumo session attach <LUM-N>\`.`
  )
  return EXIT_USAGE
}
