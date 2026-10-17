/**
 * The same untrusted-text guards the text views apply, for `--json` values.
 *
 * JSON.stringify already escapes control characters, but a member- or
 * externally-authored string read back by an agent still needs the defang
 * the text path gives it: a block body (task description, comment, Slack /
 * web snapshot) goes through the guard half of `fenceUntrustedText` (no fence
 * — a JSON value has no place for one); a one-line field goes through
 * `guardInlineText`, exactly as the text view prints it.
 */
import { guardUntrustedContent } from '../../../shared/src/untrusted-content'
import { guardInlineText } from '../../../shared/src/untrusted-fence'
import { sanitizeField } from './sanitize'

/** Block text: sanitize + defang wrapper tags (the fence body). Null stays null. */
export function guardJsonBlock<T extends string | null | undefined>(
  text: T
): T {
  if (typeof text !== 'string') return text
  return guardUntrustedContent(sanitizeField(text)).text as T
}

/** One-line text: the inline guard the text view prints. Null stays null. */
export function guardJsonInline<T extends string | null | undefined>(
  text: T
): T {
  if (typeof text !== 'string') return text
  return guardInlineText(text) as T
}
