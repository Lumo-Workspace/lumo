/**
 * LUM-879 — what is left of a PR-mirrored comment once its repository leaves
 * the workspace (uninstall, removal from the installation, deletion,
 * transfer): the discussion stays, the code goes.
 *
 * A comment mirrored from GitHub is rendered from its markdown
 * (`githubMarkdownToLumoHtml`, LUM-1305): a fenced block — a
 * ```` ```suggestion ```` block included — is a `<pre><code
 * class="language-…">` block, as is the code of a comment written in Lumo.
 * Comments mirrored before LUM-1305 were stored escaped and paragraph-ized,
 * so their fences survive as literal fence lines between `<br>` / paragraph
 * breaks. All are replaced by a marker that keeps the fence's info string
 * (`suggestion`, `ts`, …), so a reader still sees that code was there and
 * what kind; everything else — the text, the mirror header, inline `code` —
 * is kept as is. PURE and idempotent.
 */

/** What a removed block leaves behind. Language-neutral: it is stored data. */
export const CODE_REMOVED_MARK = '✂️'

/** Line breaks of the stored HTML: `<br>` and paragraph boundaries. */
const SEPARATOR = /(<br\s*\/?>|<\/p>\s*<p(?:\s[^>]*)?>|<p(?:\s[^>]*)?>|<\/p>)/i

/** Tags and whitespace before a line's text. */
const LEADING = /^(?:\s|<[^>]+>)*/
/** Closing tags and whitespace after a line's text. */
const TRAILING = /(?:\s|<\/[^>]+>)*$/

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})([^`<]*)$/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/

const PRE_BLOCK = /<pre(?:\s[^>]*)?>[\s\S]*?<\/pre>/gi
const CODE_LANGUAGE = /<code\b[^>]*\bclass="[^"]*\blanguage-([\w+#.-]+)/i

function splitLine(line: string) {
  const lead = LEADING.exec(line)?.[0] ?? ''
  const rest = line.slice(lead.length)
  const trail = TRAILING.exec(rest)?.[0] ?? ''
  return { lead, text: rest.slice(0, rest.length - trail.length), trail }
}

/** `&nbsp;` is how a sanitizer may store a leading space. */
function plain(text: string) {
  return text.replace(/&nbsp;/g, ' ')
}

function mark(info: string) {
  const label = info.trim().split(/\s+/)[0] ?? ''
  return label ? `${CODE_REMOVED_MARK} ${label}` : CODE_REMOVED_MARK
}

function stripFences(html: string): string {
  const parts = html.split(SEPARATOR)
  // Even indices are lines, odd ones the separators between them.
  const out: string[] = []
  let changed = false
  let i = 0
  while (i < parts.length) {
    const line = parts[i] ?? ''
    const { lead, text } = splitLine(line)
    const open = FENCE_OPEN.exec(plain(text))
    if (i % 2 === 1 || !open) {
      out.push(line)
      i++
      continue
    }
    const fence = open[1]!
    // Find the closing fence: same character, at least as long. An
    // unclosed fence runs to the end, as in markdown.
    let end = parts.length - 1
    for (let j = i + 2; j < parts.length; j += 2) {
      const close = FENCE_CLOSE.exec(plain(splitLine(parts[j] ?? '').text))
      if (
        close &&
        close[1]![0] === fence[0] &&
        close[1]!.length >= fence.length
      ) {
        end = j
        break
      }
    }
    if (end % 2 === 1) end -= 1
    // Drop the lines and their `<br>`s, but keep every paragraph tag in the
    // span so the HTML stays balanced; paragraphs left empty go below.
    out.push(`${lead}${mark(open[2] ?? '')}`)
    for (let k = i + 1; k <= end; k += 2) {
      const separator = parts[k] ?? ''
      if (!/^<br/i.test(separator)) out.push(separator)
    }
    out.push(splitLine(parts[end] ?? '').trail)
    changed = true
    i = end + 1
  }
  if (!changed) return html
  return out.join('').replace(/<p(?:\s[^>]*)?>\s*<\/p>/gi, '')
}

/**
 * The stored comment HTML with every code block (fenced, suggestion, `<pre>`)
 * replaced by `CODE_REMOVED_MARK`. Returns the input unchanged when it holds
 * no code block.
 */
export function stripCodeBlocksFromCommentHtml(html: string): string {
  const withoutPre = html.replace(
    PRE_BLOCK,
    block => `<p>${mark(CODE_LANGUAGE.exec(block)?.[1] ?? '')}</p>`
  )
  return stripFences(withoutPre)
}
