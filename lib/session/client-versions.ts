import { parseCliVersion } from '@/lib/api/cli-version-gate'

/**
 * LUM-1136 — the Lumo CLI version a hook reports, shown on the members page.
 * The header is untrusted client input: anything that is not a well-formed
 * version is dropped (never stored).
 */
export interface ClientVersions {
  cliVersion?: string
}

const CLI_VERSION_HEADER = 'X-Lumo-Cli-Version'

/** The valid version header on `headers`; an absent / malformed one is omitted. */
export function parseClientVersionHeaders(headers: Headers): ClientVersions {
  const out: ClientVersions = {}
  const cli = parseCliVersion(headers.get(CLI_VERSION_HEADER))
  if (cli) out.cliVersion = cli.join('.')
  return out
}
