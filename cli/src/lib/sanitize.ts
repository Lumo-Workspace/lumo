// Matches C0 control chars EXCEPT tab (\x09) and newline (\x0a), plus DEL (\x7f).
// Includes ESC (\x1b), the ANSI escape-sequence injection vector.
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g

/**
 * Strip terminal control characters from untrusted, server-returned fields
 * before printing them, to prevent ANSI escape-sequence injection. Tab and
 * newline are preserved so fixed-width tables and multi-line bodies render
 * correctly. Callers handle optional values, e.g. `sanitizeField(name ?? '')`.
 */
export function sanitizeField(value: string): string {
  return value.replace(CONTROL_CHARS, '')
}
