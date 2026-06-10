// Matches C0 control chars EXCEPT tab (\x09) and newline (\x0a), DEL (\x7f),
// and the C1 control range (\x80-\x9f). Includes ESC (\x1b) and the 8-bit CSI
// introducer (\x9b) — both ANSI escape-sequence injection vectors. U+0080-U+009F
// are never legitimate visible text, so stripping them is safe.
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Strip terminal control characters from untrusted free text before it is
 * printed (CLI) or injected into an agent's context (server render boundary),
 * to prevent ANSI escape-sequence injection. Tab and newline are preserved so
 * fixed-width tables and multi-line bodies render correctly. ids / urls /
 * enums don't need this — only free text does. Callers handle optional
 * values, e.g. `sanitizeField(name ?? '')`.
 *
 * Single source of truth shared by the CLI (cli/src/lib/sanitize.ts) and the
 * server (lib/utils/sanitize.ts) so the two sides can never drift (LUM-346).
 */
export function sanitizeField(value: string): string {
  return value.replace(CONTROL_CHARS, '')
}
