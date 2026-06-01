// Matches C0 control chars EXCEPT tab (\x09) and newline (\x0a), DEL (\x7f),
// and the C1 control range (\x80-\x9f). Includes ESC (\x1b) and the 8-bit CSI
// introducer (\x9b) — both ANSI escape-sequence injection vectors. U+0080-U+009F
// are never legitimate visible text, so stripping them is safe.
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Strip terminal control characters from untrusted, server-returned fields
 * before printing them, to prevent ANSI escape-sequence injection. Tab and
 * newline are preserved so fixed-width tables and multi-line bodies render
 * correctly. Callers handle optional values, e.g. `sanitizeField(name ?? '')`.
 */
export function sanitizeField(value: string): string {
  return value.replace(CONTROL_CHARS, '')
}
