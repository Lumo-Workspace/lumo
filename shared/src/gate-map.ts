/**
 * Check-command recognition for the delivery checks panel (LUM-614, reshaped in
 * LUM-839). Decides which of the agent's own shell commands count as a check it
 * ran (a type check, build or test run), so the panel can list them under
 * "Agent self-reported" next to the independent CI checks.
 *
 * LUM-839 dropped the fixed typecheck/build/test gate taxonomy: CI checks are
 * shown by their own names (no name → key mapping), and the agent's commands
 * are shown raw. This module only answers "is this command a check run?" — it
 * never labels one, and it carries no status (status comes from the HookEvent
 * row that recorded the run).
 */

/**
 * Invocation tokens that mark a shell command as a check run. Matched against
 * the unquoted invocation only (see unquotedInvocation).
 */
const CHECK_COMMAND_PATTERNS: readonly RegExp[] = [
  // type check
  /\btsc\b/,
  /typecheck/,
  // build
  /\bnext\s+build\b/,
  /\bnpm\s+run\s+build\b/,
  // tests
  /\bjest\b/,
  /\bvitest\b/,
  /\bnpm\s+(run\s+)?test\b/,
]

/**
 * Strip double- and single-quoted substrings from a command line, leaving only
 * the unquoted invocation tokens. This is what stops a check keyword that merely
 * appears inside an *argument* — e.g. a `lumo task create "…typecheck/build/
 * test…"` description, or `echo "…run the test…"` — from being mistaken for a
 * check run (the LUM-614 prod false-positive). A real check run names its tool
 * unquoted, so it survives the strip.
 */
function unquotedInvocation(command: string): string {
  return command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, ' ')
}

/**
 * True when an executed shell command runs a check (type check, build or test).
 * A chained line (`npx jest …; npx tsc --noEmit`) is one check command — it is
 * shown once, as the agent ran it.
 */
export function isCheckCommand(command: string): boolean {
  const invocation = unquotedInvocation(command)
  return CHECK_COMMAND_PATTERNS.some(p => p.test(invocation))
}
