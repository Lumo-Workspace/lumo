import MarkdownIt from 'markdown-it'

type TiptapMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'code' }
  | { type: 'link'; attrs: { href: string } }

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
}

/** A top-level Tiptap doc node whose content array is always present. */
export interface TiptapDoc extends TiptapNode {
  type: 'doc'
  content: TiptapNode[]
}

interface MarkdownItToken {
  type: string
  tag: string
  attrs?: [string, string][] | null
  content: string
  children?: MarkdownItToken[] | null
  info?: string
  markup?: string
  level: number
  attrGet?: (name: string) => string | null
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false })

/**
 * Parse a markdown string into a Tiptap JSON doc node.
 * Supports paragraphs, headings (h1-h6), bullet/ordered lists, fenced
 * code blocks, blockquotes, and inline marks (bold, italic, code, link).
 * Unsupported nodes degrade to plain text inside a paragraph.
 */
export function markdownToTiptap(input: string): TiptapDoc {
  if (!input || input.length === 0) {
    return { type: 'doc' as const, content: [] }
  }
  const tokens = md.parse(input, {}) as MarkdownItToken[]
  const content = blocksFromTokens(tokens)
  return { type: 'doc' as const, content }
}

function blocksFromTokens(tokens: MarkdownItToken[]): TiptapNode[] {
  const out: TiptapNode[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    switch (t.type) {
      case 'paragraph_open': {
        const end = findMatch(tokens, i, 'paragraph_close')
        const inline = tokens[i + 1]
        out.push({
          type: 'paragraph',
          content: inline ? inlineFromToken(inline) : [],
        })
        i = end
        break
      }
      case 'heading_open': {
        const level = parseInt(t.tag.replace('h', ''), 10)
        const end = findMatch(tokens, i, 'heading_close')
        const inline = tokens[i + 1]
        out.push({
          type: 'heading',
          attrs: { level },
          content: inline ? inlineFromToken(inline) : [],
        })
        i = end
        break
      }
      case 'bullet_list_open':
      case 'ordered_list_open': {
        const isOrdered = t.type === 'ordered_list_open'
        const closeType = isOrdered ? 'ordered_list_close' : 'bullet_list_close'
        const end = findMatch(tokens, i, closeType)
        const slice = tokens.slice(i + 1, end)
        out.push({
          type: isOrdered ? 'orderedList' : 'bulletList',
          content: listItemsFromTokens(slice),
        })
        i = end
        break
      }
      case 'fence': {
        out.push({
          type: 'codeBlock',
          attrs: { language: t.info || null },
          content: t.content ? [{ type: 'text', text: t.content }] : [],
        })
        break
      }
      case 'blockquote_open': {
        const end = findMatch(tokens, i, 'blockquote_close')
        const slice = tokens.slice(i + 1, end)
        out.push({ type: 'blockquote', content: blocksFromTokens(slice) })
        i = end
        break
      }
      default:
        break
    }
  }
  return out
}

function listItemsFromTokens(tokens: MarkdownItToken[]): TiptapNode[] {
  const items: TiptapNode[] = []
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.type === 'list_item_open') {
      const end = findMatch(tokens, i, 'list_item_close')
      const inner = tokens.slice(i + 1, end)
      items.push({ type: 'listItem', content: blocksFromTokens(inner) })
      i = end
    }
  }
  return items
}

function inlineFromToken(t: MarkdownItToken): TiptapNode[] {
  if (!t.children) {
    return t.content ? [{ type: 'text', text: t.content }] : []
  }
  const out: TiptapNode[] = []
  const markStack: TiptapMark[] = []
  for (const child of t.children) {
    switch (child.type) {
      case 'text':
        if (child.content) {
          out.push(makeText(child.content, markStack))
        }
        break
      case 'softbreak':
      case 'hardbreak':
        out.push(makeText('\n', markStack))
        break
      case 'code_inline':
        out.push(makeText(child.content, [...markStack, { type: 'code' }]))
        break
      case 'strong_open':
        markStack.push({ type: 'bold' })
        break
      case 'strong_close':
        markStack.pop()
        break
      case 'em_open':
        markStack.push({ type: 'italic' })
        break
      case 'em_close':
        markStack.pop()
        break
      case 'link_open': {
        // markdown-it Token may expose attrGet or a raw attrs array
        let href = ''
        if (typeof child.attrGet === 'function') {
          href = child.attrGet('href') ?? ''
        } else {
          href = child.attrs?.find(a => a[0] === 'href')?.[1] ?? ''
        }
        markStack.push({ type: 'link', attrs: { href } })
        break
      }
      case 'link_close':
        markStack.pop()
        break
      default:
        if (child.content) {
          out.push(makeText(child.content, markStack))
        }
    }
  }
  return out
}

function makeText(text: string, marks: TiptapMark[]): TiptapNode {
  const node: TiptapNode = { type: 'text', text }
  if (marks.length > 0) node.marks = marks.map(cloneMark)
  return node
}

function cloneMark(m: TiptapMark): TiptapMark {
  if (m.type === 'link') return { type: 'link', attrs: { ...m.attrs } }
  return { type: m.type } as TiptapMark
}

function findMatch(
  tokens: MarkdownItToken[],
  start: number,
  closeType: string
): number {
  const startLevel = tokens[start]?.level ?? 0
  for (let i = start + 1; i < tokens.length; i++) {
    if (tokens[i]?.type === closeType && tokens[i]?.level === startLevel) {
      return i
    }
  }
  return tokens.length - 1
}

/**
 * Render a Tiptap JSON doc node back to markdown text.
 * Best-effort: paragraphs, headings, lists, code blocks, mention nodes.
 * Returns '' for null/non-object input.
 */
export function tiptapToMarkdown(doc: TiptapNode | object): string {
  if (!doc || typeof doc !== 'object') return ''
  const node = doc as TiptapNode
  if (!Array.isArray(node.content)) return ''
  const lines = node.content.map(renderBlock).filter(Boolean)
  return lines.join('\n')
}

function renderBlock(block: TiptapNode): string {
  switch (block.type) {
    case 'paragraph':
      return renderInlines(block.content ?? []) + '\n'
    case 'heading': {
      const level = (block.attrs?.level as number | undefined) ?? 1
      return '#'.repeat(level) + ' ' + renderInlines(block.content ?? []) + '\n'
    }
    case 'bulletList':
      return (
        (block.content ?? [])
          .map(item => '- ' + renderListItem(item))
          .join('\n') + '\n'
      )
    case 'orderedList':
      return (
        (block.content ?? [])
          .map((item, idx) => `${idx + 1}. ` + renderListItem(item))
          .join('\n') + '\n'
      )
    case 'codeBlock': {
      const lang = (block.attrs?.language as string | undefined) ?? ''
      const body = (block.content ?? [])
        .map(c => c.text ?? '')
        .join('')
      return '```' + lang + '\n' + body + '```\n'
    }
    case 'blockquote':
      return (
        (block.content ?? [])
          .map(b => '> ' + renderBlock(b))
          .join('') + '\n'
      )
    default:
      return ''
  }
}

function renderListItem(item: TiptapNode): string {
  const blocks = item.content ?? []
  return blocks.map(b => renderInlines(b.content ?? [])).join(' ')
}

function renderInlines(nodes: TiptapNode[]): string {
  return nodes.map(renderInline).join('')
}

function renderInline(node: TiptapNode): string {
  if (node.type === 'mention') {
    const ident = (node.attrs?.identifier as string | undefined) ?? ''
    return ident ? `@${ident}` : ''
  }
  if (node.type !== 'text') return ''
  let text = node.text ?? ''
  if (!node.marks) return text
  for (const mark of node.marks) {
    switch (mark.type) {
      case 'bold':
        text = `**${text}**`
        break
      case 'italic':
        text = `*${text}*`
        break
      case 'code':
        text = `\`${text}\``
        break
      case 'link': {
        const href = mark.attrs?.href ?? ''
        text = `[${text}](${href})`
        break
      }
    }
  }
  return text
}
