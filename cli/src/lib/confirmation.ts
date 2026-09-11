/**
 * Confirmation protocol (LUM-755).
 *
 * A mutation that needs human approval is neither an interactive
 * "are you sure? [y/N]" (an agent has no stdin to answer it) nor a bare text
 * refusal on stderr (exit 1 is indistinguishable from a real error, and the
 * agent is left grepping prose). Instead the command:
 *
 *   1. computes, from real server/local state, what it is about to do;
 *   2. prints a structured envelope to **stdout** and exits **4**
 *      (`EXIT_CONFIRMATION_REQUIRED`) without sending any mutation;
 *   3. hands back a copy-pasteable `confirmCommand` — the same argv with
 *      `--confirm` appended (plus any second-gate flag such as `--force`).
 *
 * The agent shows `changes` to the user; only after the user approves does
 * it re-run `confirmCommand` verbatim. `--confirm` therefore means "the user
 * has confirmed" — it is not a flag an agent may add on its own initiative.
 *
 * Output shape: JSON when stdout is not a TTY (the agent path), a readable
 * text rendering of the same fields on a TTY. There is no prompt in either
 * mode — a human and an agent walk the same protocol.
 *
 * Exit codes (see `wrap()` in cli/src/index.ts): 0 ok · 1 error · 4 confirm.
 */

export const EXIT_CONFIRMATION_REQUIRED = 4

export interface ConfirmationEnvelope {
  status: 'confirmation_required'
  command: string
  changes: string[]
  confirmCommand: string
}

export interface ConfirmationInput {
  /** Command path as the user typed it, e.g. `sprint delete`. */
  command: string
  /** Human-readable, state-derived description of what would happen. */
  changes: string[]
  /** Raw argv after `lumo` (defaults to `process.argv.slice(2)`). */
  argv?: string[]
  /** Second-gate flags to add alongside --confirm (e.g. `--force`). */
  extraFlags?: string[]
}

/** The flags a command may carry to signal user approval. */
export interface ConfirmFlags {
  confirm?: boolean | undefined
  /** Legacy alias of --confirm, kept for callers written before LUM-755. */
  yes?: boolean | undefined
}

/** `--confirm`, or its legacy `--yes` alias. */
export function isConfirmed(opts: ConfirmFlags): boolean {
  return Boolean(opts.confirm || opts.yes)
}

/** POSIX-shell quoting: bare when safe, single-quoted otherwise. */
export function shellQuote(arg: string): string {
  if (arg.length > 0 && /^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

/**
 * Rebuild the invocation the user ran, plus `--confirm` (and any
 * `extraFlags`). Flags already present in argv are never duplicated, and
 * `--confirm` always lands last so the command reads as "…, approved".
 */
export function buildConfirmCommand(
  argv: string[] = process.argv.slice(2),
  extraFlags: string[] = []
): string {
  const kept = argv.filter(a => a !== '--confirm')
  const parts = ['lumo', ...kept.map(shellQuote)]
  for (const flag of extraFlags) {
    if (!kept.includes(flag)) parts.push(flag)
  }
  parts.push('--confirm')
  return parts.join(' ')
}

export function buildEnvelope(input: ConfirmationInput): ConfirmationEnvelope {
  return {
    status: 'confirmation_required',
    command: input.command,
    changes: input.changes,
    confirmCommand: buildConfirmCommand(input.argv, input.extraFlags),
  }
}

/** JSON for pipes; the same fields as readable text for a terminal. */
export function renderConfirmation(
  envelope: ConfirmationEnvelope,
  isTTY: boolean
): string {
  if (!isTTY) return JSON.stringify(envelope, null, 2) + '\n'
  const lines = [
    `Confirmation required — \`lumo ${envelope.command}\` was not run.`,
    ...envelope.changes.map(c => `  - ${c}`),
    'Re-run with --confirm once the user has approved:',
    `  ${envelope.confirmCommand}`,
  ]
  return lines.join('\n') + '\n'
}

/**
 * Print the envelope to stdout and return the exit code the command should
 * propagate. Nothing goes to stderr: the envelope is the command's result,
 * not an error.
 */
export function emitConfirmation(input: ConfirmationInput): number {
  const envelope = buildEnvelope(input)
  process.stdout.write(
    renderConfirmation(envelope, Boolean(process.stdout.isTTY))
  )
  return EXIT_CONFIRMATION_REQUIRED
}
