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
  /** LUM-769: a server-issued read receipt when the command's write step
   *  is handshake-gated — `confirmCommand` already carries it as
   *  `--receipt <token>`; surfaced here for machine readers. Absent on
   *  commands without a receipt. */
  receipt?: { token: string; expiresAt: string }
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
  /** LUM-769 read receipt; also appended to confirmCommand as `--receipt <token>`. */
  receipt?: { token: string; expiresAt: string }
  /** The approval flag this envelope asks for (default `--confirm`). A
   *  multi-step handshake (LUM-769) issues an earlier envelope that asks for
   *  `--confirm-read` first; the flag means "the user approved THIS step". */
  confirmFlag?: '--confirm' | '--confirm-read'
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

/** Flags that belong to a previous step of a handshake and must not carry
 *  over into the next step's command: the step flags themselves and a prior
 *  `--receipt <token>` pair (the next envelope brings its own receipt). */
const STEP_FLAGS = new Set(['--confirm', '--confirm-read'])

function stripStepFlags(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (STEP_FLAGS.has(a)) continue
    if (a === '--receipt') {
      i++ // drop its value too
      continue
    }
    if (a.startsWith('--receipt=')) continue
    out.push(a)
  }
  return out
}

/**
 * Rebuild the invocation the user ran, plus the approval flag (default
 * `--confirm`) and any `extraFlags`. Step flags and a prior `--receipt` from
 * an earlier handshake step are dropped first, flags already present in argv
 * are never duplicated, and the approval flag always lands last so the
 * command reads as "…, approved".
 */
export function buildConfirmCommand(
  argv: string[] = process.argv.slice(2),
  extraFlags: string[] = [],
  confirmFlag: '--confirm' | '--confirm-read' = '--confirm'
): string {
  const kept = stripStepFlags(argv)
  const parts = ['lumo', ...kept.map(shellQuote)]
  for (const flag of extraFlags) {
    if (!kept.includes(flag)) parts.push(flag)
  }
  parts.push(confirmFlag)
  return parts.join(' ')
}

export function buildEnvelope(input: ConfirmationInput): ConfirmationEnvelope {
  const extraFlags = [
    ...(input.extraFlags ?? []),
    ...(input.receipt ? ['--receipt', input.receipt.token] : []),
  ]
  return {
    status: 'confirmation_required',
    command: input.command,
    changes: input.changes,
    confirmCommand: buildConfirmCommand(
      input.argv,
      extraFlags,
      input.confirmFlag ?? '--confirm'
    ),
    ...(input.receipt ? { receipt: input.receipt } : {}),
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
    ...(envelope.receipt
      ? [`Read receipt issued (valid until ${envelope.receipt.expiresAt}).`]
      : []),
    `Re-run with ${envelope.confirmCommand.endsWith('--confirm-read') ? '--confirm-read' : '--confirm'} once the user has approved:`,
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
