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

/**
 * LUM-1233 batch 3a: first CLI release whose milestone test cases take the
 * single `<milestone-slug>/TC<n>` handle (and `testcase delete`). Same release
 * as batch 1 unless one ships in between — then raise this one.
 * `LUMO_TESTCASE_HANDLE_MIN_CLI_VERSION` overrides it per deployment.
 */
export const TESTCASE_HANDLE_MIN_CLI_VERSION = '1.125.5'

/**
 * LUM-1233 batch 3b: first CLI release with `memory add|list --scope`,
 * `memory update --scope project` and `memory delete` (no `task memory`,
 * `project memory`, `memory rm`, `memory promote`). Raise it if a release
 * ships between batches. `LUMO_MEMORY_SCOPE_MIN_CLI_VERSION` overrides it.
 */
export const MEMORY_SCOPE_MIN_CLI_VERSION = '1.125.5'

export interface CliCommandNames {
  /** True when the caller's CLI has the batch-1 read entry points. */
  readonly current: boolean
  /** True when the caller's CLI takes the batch-3a test-case handle. */
  readonly testCaseHandle: boolean
  /** True when the caller's CLI has the batch-3b `memory --scope` commands. */
  readonly memoryScope: boolean
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
  /** Run a milestone test case (`slug` null = a `<milestone>` placeholder). */
  milestoneTestCaseRun(slug: string | null): string
  /** How to browse project and task memories (inline Markdown). */
  readonly memoryBrowse: string
  /** How to delete one memory by `<ref>` (inline Markdown). */
  readonly memoryDelete: string
}

function commandNames(
  readEntry: boolean,
  testCaseHandle: boolean,
  memoryScope: boolean
): CliCommandNames {
  return {
    current: readEntry,
    testCaseHandle,
    memoryScope,
    memoryBrowse: memoryScope
      ? '`lumo memory list --scope project` / `lumo memory list`'
      : '`lumo project memory list` / `lumo task memory list`',
    memoryDelete: memoryScope
      ? '`lumo memory delete <ref>` (it exits 4: show the user the envelope and run its `--confirm` command once they approve)'
      : '`lumo memory rm <ref> --yes`',
    taskContextBound: readEntry ? 'lumo task show --full' : 'lumo task context',
    taskContext: id =>
      readEntry ? `lumo task show ${id} --full` : `lumo task context ${id}`,
    taskContextFull: id =>
      readEntry
        ? `lumo task show ${id} --full --memory`
        : `lumo task context ${id} --full`,
    taskComments: id =>
      readEntry
        ? `lumo task show ${id} --comments`
        : `lumo task comments list ${id}`,
    taskDeps: id =>
      readEntry ? `lumo task show ${id} --deps` : `lumo task deps list ${id}`,
    milestoneTestCaseRun: slug =>
      testCaseHandle
        ? `lumo milestone testcase run ${slug ?? '<milestone>'}/TC<n> --result … --env …`
        : 'lumo milestone testcase run <milestone> TC<n> --result … --env …',
  }
}

export const LEGACY_CLI_COMMANDS: CliCommandNames = commandNames(
  false,
  false,
  false
)

export const CURRENT_CLI_COMMANDS: CliCommandNames = commandNames(
  true,
  true,
  true
)

function atLeast(
  a: [number, number, number],
  b: [number, number, number]
): boolean {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! > b[i]!
  }
  return true
}

function floorFrom(value: string | undefined, fallback: string): string {
  const override = value?.trim()
  return override && parseCliVersion(override) ? override : fallback
}

/** The read-entry floor in force: a valid env override, else the constant. */
export function resolveReadEntryMinVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return floorFrom(
    env.LUMO_READ_ENTRY_MIN_CLI_VERSION,
    READ_ENTRY_MIN_CLI_VERSION
  )
}

/** The test-case-handle floor in force: a valid env override, else the constant. */
export function resolveTestCaseHandleMinVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return floorFrom(
    env.LUMO_TESTCASE_HANDLE_MIN_CLI_VERSION,
    TESTCASE_HANDLE_MIN_CLI_VERSION
  )
}

/** The memory-scope floor in force: a valid env override, else the constant. */
export function resolveMemoryScopeMinVersion(
  env: Record<string, string | undefined> = process.env
): string {
  return floorFrom(
    env.LUMO_MEMORY_SCOPE_MIN_CLI_VERSION,
    MEMORY_SCOPE_MIN_CLI_VERSION
  )
}

/** The command names for a CLI reporting `version` (null / malformed = legacy). */
export function cliCommandNamesForVersion(
  version: string | null | undefined,
  env: Record<string, string | undefined> = process.env
): CliCommandNames {
  const sent = parseCliVersion(version)
  if (!sent) return LEGACY_CLI_COMMANDS
  const at = (floor: string) => {
    const f = parseCliVersion(floor)
    return f ? atLeast(sent, f) : false
  }
  const readEntry = at(resolveReadEntryMinVersion(env))
  const testCaseHandle = at(resolveTestCaseHandleMinVersion(env))
  const memoryScope = at(resolveMemoryScopeMinVersion(env))
  if (readEntry && testCaseHandle && memoryScope) return CURRENT_CLI_COMMANDS
  if (!readEntry && !testCaseHandle && !memoryScope) return LEGACY_CLI_COMMANDS
  return commandNames(readEntry, testCaseHandle, memoryScope)
}

/** The command names for the CLI that sent `headers`. */
export function cliCommandNamesFromHeaders(
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): CliCommandNames {
  return cliCommandNamesForVersion(headers.get(CLI_VERSION_HEADER), env)
}
