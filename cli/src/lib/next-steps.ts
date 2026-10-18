import { sanitizeField } from './sanitize'

/**
 * Rendering half of next-step suggestions (LUM-686).
 *
 * The rules that decide WHICH steps apply live server-side
 * (`lib/context/render/next-steps.ts`) — they depend on task status and
 * session binding. This module only renders, so it serves two
 * kinds of source without caring which it got:
 *
 *  - server-computed — `lumo status --next` and the task commands, carried on the
 *    response as `nextSteps`;
 *  - locally static — `worktree add` / `setup`, whose advice is fixed process
 *    wrap-up with no server round-trip to piggyback on.
 *
 * The shape is duplicated rather than imported from `lib/` on purpose: the CLI
 * is a separately published package and must not pull the Next.js app into its
 * build graph (same reason `shared/src/sanitize.ts` exists).
 */
export interface NextStep {
  /** Null for advice with nothing to run — e.g. "wait for the human review". */
  command: string | null
  why: string
}

/**
 * Just the slice of the environment this module reads. Narrower than
 * NodeJS.ProcessEnv so tests can pass a bare object literal.
 */
export type EnvLike = Record<string, string | undefined>

/** Mirrors NEXT_STEPS_MAX server-side; a defence in depth, not the only cap. */
export const NEXT_STEPS_MAX = 3

const HEADING = 'Next:'

/**
 * True when the user has muted suggestions. Hints cost tokens on every command;
 * anyone who finds them noise must be able to turn them off for good.
 */
export function nextStepsSilenced(
  env: EnvLike = process.env,
  opts: { hints?: boolean } = {}
): boolean {
  // Commander maps `--no-hints` to `opts.hints === false`.
  if (opts.hints === false) return true
  const flag = env.LUMO_NO_HINTS
  return flag !== undefined && flag !== '' && flag !== '0'
}

/**
 * Render the trailing suggestion block. Returns "" when there is nothing to
 * say, so callers can append unconditionally without emitting a bare heading.
 */
export function formatNextSteps(steps: NextStep[]): string {
  const capped = steps.slice(0, NEXT_STEPS_MAX)
  if (capped.length === 0) return ''
  const lines = [HEADING]
  for (const step of capped) {
    const why = sanitizeField(step.why)
    lines.push(
      step.command === null
        ? `  ${why}`
        : `  ${sanitizeField(step.command)}\n      ${why}`
    )
  }
  return lines.join('\n')
}

/**
 * Write the block to **stdout**, after the command's own result line.
 *
 * Deliberately not stderr: suggestions are not errors, `2>/dev/null` would
 * swallow them, some harnesses read any stderr output as failure, and with
 * both streams redirected to one file the block can surface *above* the result
 * it follows. Machine consumers are served by `--json` instead, where the
 * steps ride as a field rather than as text.
 */
export function emitNextSteps(
  steps: NextStep[],
  opts: { hints?: boolean } = {},
  out: { write(s: string): unknown } = process.stdout,
  env: EnvLike = process.env
): void {
  if (nextStepsSilenced(env, opts)) return
  const block = formatNextSteps(steps)
  if (block === '') return
  out.write(`\n${block}\n`)
}
