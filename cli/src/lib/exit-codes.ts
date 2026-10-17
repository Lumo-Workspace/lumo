/**
 * LUM-1232 batch E — the CLI's exit codes in one place
 * (docs/cli-output-conventions.md X-4). Lumo's 4 and 5 are NOT gh's: gh uses
 * 4 for "authentication required"; Lumo's 4 means "the user must confirm,
 * then re-run confirmCommand" and 5 means "blocked; relay, don't retry".
 */
export { EXIT_CONFIRMATION_REQUIRED } from './confirmation'
export { EXIT_BLOCKED } from './blocked-error'

/** Success, including an empty result. */
export const EXIT_OK = 0
/** The command failed: not found, auth, permission, server, network. */
export const EXIT_ERROR = 1
/**
 * Usage error — unknown flag, missing or extra argument, invalid flag value —
 * caught before any network call. The call itself is wrong; fix the command.
 */
export const EXIT_USAGE = 2
