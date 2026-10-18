import { CLI_VERSION_HEADER, parseCliVersion } from '@/lib/api/cli-version'

/**
 * LUM-1233 batch 1 — the CLI commands the server names in text it writes for
 * an agent (memory index header, comment pointer, session-start progress and
 * dependency notes), picked by the caller's CLI version.
 *
 * Batch 1 removed `task context`, `task wrapup`, `task comments list`,
 * `task deps list` and friends in favour of `task show` aspect flags. An older
 * CLI does not have `task show --full`, so it must keep being pointed at the
 * names it has (docs/cli-command-structure.md RN-2 step 5). The version comes
 * from `X-Lumo-Cli-Version` (sent on every CLI request since LUM-1110); a
 * request without it — an older CLI, a browser, an MCP client — gets the
 * legacy names.
 */

/**
 * First CLI release that has `task show --full` and no `task context`. The
 * milestone's single CLI release ships batch 1, so any version above 1.125.4
 * qualifies; raise this if a release is cut from a main that lacks batch 1.
 * `LUMO_READ_ENTRY_MIN_CLI_VERSION` overrides it per deployment.
 */
export const READ_ENTRY_MIN_CLI_VERSION = '1.125.5'

export interface CliCommandNames {
  /** True when the caller's CLI has the batch-1 read entry points. */
  readonly current: boolean
  /** Read the whole task context of the session-bound task (no ref). */
  readonly taskContextBound: string
  /** Read the whole task context. */
  taskContext(identifier: string): string
  /** Read the context with every memory body. */
  taskContextFull(identifier: string): string
  /** Read the comment thread. */
  taskComments(identifier: string): string
  /** Read the dependency edges. */
  taskDeps(identifier: string): string
}

export const LEGACY_CLI_COMMANDS: CliCommandNames = {
  current: false,
  taskContextBound: 'lumo task context',
  taskContext: id => `lumo task context ${id}`,
  taskContextFull: id => `lumo task context ${id} --full`,
  taskComments: id => `lumo task comments list ${id}`,
  taskDeps: id => `lumo task deps list ${id}`,
}

export const CURRENT_CLI_COMMANDS: CliCommandNames = {
  current: true,
  taskContextBound: 'lumo task show --full',
  taskContext: id => `lumo task show ${id} --full`,
  taskContextFull: id => `lumo task show ${id} --full --memory`,
  taskComments: id => `lumo task show ${id} --comments`,
  taskDeps: id => `lumo task show ${id} --deps`,
}

function atLeast(
  a: [number, number, number],
  b: [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return true
}

/** The floor in force: a valid env override, else the constant. */
export function resolveReadEntryMinVersion(
  env: Record<string, string | undefined> = process.env
): string {
  const override = env.LUMO_READ_ENTRY_MIN_CLI_VERSION?.trim()
  if (override && parseCliVersion(override)) return override
  return READ_ENTRY_MIN_CLI_VERSION
}

/** The command names for a CLI reporting `version` (null / malformed = legacy). */
export function cliCommandNamesForVersion(
  version: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): CliCommandNames {
  const sent = parseCliVersion(version)
  const floor = parseCliVersion(resolveReadEntryMinVersion(env))
  if (!sent || !floor) return LEGACY_CLI_COMMANDS
  return atLeast(sent, floor) ? CURRENT_CLI_COMMANDS : LEGACY_CLI_COMMANDS
}

/** The command names for the CLI that sent `headers`. */
export function cliCommandNamesFromHeaders(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): CliCommandNames {
  return cliCommandNamesForVersion(headers.get(CLI_VERSION_HEADER), env)
}
