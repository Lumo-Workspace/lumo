/**
 * LUM-758 follow-up — what may be written into the TRUSTED region of a hunt or
 * plan prompt.
 *
 * Two different kinds of untrusted input reach those prompts, and they need
 * opposite treatments:
 *
 *  - **Repository paths** (`touchedPaths`, the located signal sites). The PR
 *    author names the files. A path is a structured value, so one that is not
 *    shaped like a path is not a starting point worth having: DROP it. The
 *    caller still has the rule id, and the agent can find the file itself.
 *  - **Free text produced by the planning model** (`objective`,
 *    `startingPoints`). The plan model reads attacker-influenced input — the
 *    diff's file names and the Lumo task context — so its output is
 *    untrusted-derived, and it is rendered into the hunt prompt's trusted
 *    region. Dropping is not an option here: the objective IS the task.
 *    NEUTRALISE instead — fold line breaks into spaces so nothing can leave
 *    its line, and clip.
 *
 * Kept in one module because the alternative is the same rule written at three
 * call sites, drifting apart the moment one of them is edited.
 */

/**
 * Characters that must never reach a prompt line. C0 and C1 controls plus
 * U+2028 / U+2029, which are not control bytes, survive every transport above
 * this layer, and may well be rendered as a line break by the model reading
 * the prompt.
 *
 * `sanitizeField` (shared/src/sanitize.ts) is NOT the right tool: it
 * deliberately preserves tab and newline so multi-line bodies render, and the
 * newline is the whole vector here.
 */
// TWO constants, deliberately. A `/g` regex advances `lastIndex` on `.test()`,
// so one shared object makes `isPromptSafePath` return false on every other
// call for the same input — the table-driven character test caught exactly
// that. `.replace()` needs the flag; `.test()` must not have it.
const PROMPT_UNSAFE_CHAR = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/
const PROMPT_UNSAFE_CHARS_G = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g

/**
 * Longest path worth carrying into a prompt. Row-count caps bound how many
 * paths appear, never how long each is, and a git path can run to kilobytes —
 * enough for a handful of them to dominate the budget of an agent whose whole
 * failure mode is running out of it.
 */
export const PROMPT_PATH_MAX_CHARS = 200

/** A path safe to write into a prompt line: no control characters, bounded. */
export function isPromptSafePath(path: string): boolean {
  return path.length <= PROMPT_PATH_MAX_CHARS && !PROMPT_UNSAFE_CHAR.test(path)
}

/**
 * Model-produced free text, made safe to render inside one prompt line: every
 * character that could break the line becomes a space, runs of whitespace
 * collapse, and the result is clipped.
 *
 * The clip happens HERE and not in the plan schema. A zod `.max()` is sent to
 * the model as a JSON-schema `maxLength`, and LUM-766 measured what a cap below
 * the natural length does to a reasoning model: 0/16 successful plans, the
 * whole output budget spent on reasoning with no text emitted. Bounding the
 * render is free; bounding the schema costs plans.
 */
export function neutralizeForPromptLine(text: string, maxChars: number): string {
  const flat = text.replace(PROMPT_UNSAFE_CHARS_G, ' ').replace(/\s+/g, ' ').trim()
  return flat.length <= maxChars ? flat : `${flat.slice(0, maxChars)}…`
}
