import { diffArrays } from 'diff'

/**
 * Split an HTML body into diff tokens. Each tag (`<...>`) is one atomic token;
 * text is split into word and whitespace runs. Pure string work — no DOM, so it
 * runs identically on the server, in jsdom, and in the browser.
 */
function tokenizeHtml(html: string): string[] {
  return html.match(/<[^>]+>|[^<\s]+|\s+/g) ?? []
}

function isTag(token: string): boolean {
  return token.startsWith('<') && token.endsWith('>')
}

const ESCAPE: 'ins' | 'del' = 'ins'

/**
 * Wrap a run of changed tokens. Real-text runs are wrapped in `<ins>`/`<del>`
 * and marked with `data-diff`; whitespace-only runs are emitted bare (for
 * additions, to keep spacing) or dropped (for deletions, so old spacing never
 * leaks into the new structure). Tags inside an added run pass through so the
 * new block/inline formatting renders; tags inside a removed run are dropped so
 * the deleted text survives as struck-through inline text without duplicating
 * the surrounding structure.
 */
function wrapChanged(tokens: string[], tag: 'ins' | 'del'): string {
  const diffAttr = tag === ESCAPE ? 'added' : 'removed'
  let out = ''
  let run: string[] = []

  const flush = () => {
    if (run.length === 0) return
    const text = run.join('')
    if (text.trim().length === 0) {
      if (tag === ESCAPE) out += text
    } else {
      out += `<${tag} data-diff="${diffAttr}" class="diff-${tag}">${text}</${tag}>`
    }
    run = []
  }

  for (const token of tokens) {
    if (isTag(token)) {
      flush()
      if (tag === ESCAPE) out += token
    } else {
      run.push(token)
    }
  }
  flush()
  return out
}

/**
 * Diff two tiptap HTML bodies and return a single HTML string that preserves
 * the new version's markdown formatting while marking word-level changes
 * inline: additions in `<ins data-diff="added">`, deletions in
 * `<del data-diff="removed">`. Tags are diffed as atomic tokens, so structural
 * changes follow the new document and whitespace-only edits are not highlighted.
 */
export function diffDocumentHtml(
  oldHtml: string | null | undefined,
  newHtml: string | null | undefined
): string {
  const parts = diffArrays(
    tokenizeHtml(oldHtml ?? ''),
    tokenizeHtml(newHtml ?? '')
  )

  let out = ''
  for (const part of parts) {
    if (part.added) {
      out += wrapChanged(part.value, 'ins')
    } else if (part.removed) {
      out += wrapChanged(part.value, 'del')
    } else {
      out += part.value.join('')
    }
  }
  return out
}
