/**
 * LUM-750 — environment guard for the disposition commands.
 *
 * `lumo crossing disposition` and `lumo finding disposition` record a HUMAN's
 * ruling on a blocker raised against the agent's own work. The LUM-769
 * handshake makes the read → acknowledge → confirm order un-skippable, but it
 * cannot prove a person ticked each step when an agent relays them — so the
 * commands refuse to run at all from inside an agent session: the user runs
 * them in their own terminal (with `--task <LUM-N>`, since no session binding
 * exists there). A command that dodges this guard (a stripped environment,
 * a wrapper) still lands in the hook stream, where the boundary detector
 * records a SELF_DISPOSITION crossing and rolls the ruling back.
 *
 * The signal is the Claude Code session marker itself — the same variable
 * `lumo session attach` requires — plus the `CLAUDECODE` flag the harness
 * exports. Either being set means "an agent is running this".
 */

/** The environment variables that mark an agent (Claude Code) session. */
export const AGENT_SESSION_ENV_VARS = ['CLAUDE_CODE_SESSION_ID', 'CLAUDECODE']

/** True when the process runs inside an agent session (any marker set). */
export function insideAgentSession(
  env: Record<string, string | undefined> = process.env
): boolean {
  return AGENT_SESSION_ENV_VARS.some(k => {
    const v = env[k]
    return typeof v === 'string' && v.length > 0
  })
}

/** The refusal text, naming the command the user should run themselves. */
export function agentSessionRefusal(commandLine: string): string {
  return (
    `Error: \`${commandLine}\` records the USER's ruling and is refused inside an agent session (${AGENT_SESSION_ENV_VARS.join(' / ')} is set).\n` +
    'Relay the row to the user and ask them to run the command in their own terminal, with --task <LUM-N> (no session binding exists there):\n' +
    `  ${commandLine} --task <LUM-N>\n` +
    'An agent-issued disposition is recorded as a SELF_DISPOSITION boundary crossing (HIGH) and rolled back to OPEN — do not work around this guard.'
  )
}
