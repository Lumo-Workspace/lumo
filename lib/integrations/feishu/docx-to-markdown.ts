/**
 * LUM-1343 — convert a Feishu docx block tree to Lumo Doc markdown.
 *
 * Pure: no I/O, no clock. Image bytes are copied by the import service
 * beforehand and arrive here as `imageUrls` (Feishu image token → Lumo file
 * route URL); an image that could not be copied becomes a link back.
 *
 * Block model (https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/data-structure/block):
 * every block has `block_id`, `block_type`, optional `children` (ids), and a
 * content object keyed by its type name (`text`, `heading1`, `table`, …).
 *
 * Feishu content is untrusted. Every piece of text is control-char stripped
 * and markdown-escaped, so it can never open a construct of its own, and
 * links keep only http(s)/mailto targets. The markdown renderer
 * (shared/src/markdown-tiptap.ts) runs with `html: false` on top of that.
 *
 * Supported: page, text, heading1–9 (7–9 → h6), bullet, ordered, code,
 * quote, todo, callout, divider, image, table / table_cell, quote_container,
 * grid / grid_column and synced blocks (their children are kept inline).
 * Everything else becomes one placeholder line linking back to Feishu.
 */
import { sanitizeField } from '@/lib/utils/sanitize'

// ── Types ───────────────────────────────────────────────────────────────────

export interface FeishuTextStyle {
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  underline?: boolean
  inline_code?: boolean
  link?: { url?: string }
}

export interface FeishuTextElement {
  text_run?: { content?: string; text_element_style?: FeishuTextStyle }
  mention_user?: { user_id?: string; text_element_style?: FeishuTextStyle }
  mention_doc?: {
    token?: string
    obj_type?: number
    url?: string
    title?: string
    text_element_style?: FeishuTextStyle
  }
  equation?: { content?: string; text_element_style?: FeishuTextStyle }
  reminder?: { expire_time?: string | number }
  file?: { file_token?: string }
  inline_block?: { block_id?: string }
  undefined_element?: Record<string, never>
}

export interface FeishuTextBody {
  elements?: FeishuTextElement[]
  style?: { done?: boolean; language?: number; sequence?: string }
}

export interface FeishuBlock {
  block_id: string
  parent_id?: string
  children?: string[]
  block_type: number
  [key: string]: unknown
}

export interface ConvertOptions {
  /** Canonical Feishu URL of the source, for placeholders' link back. */
  sourceUrl: string
  /** Feishu image token → stored Lumo URL. Missing → link back. */
  imageUrls?: ReadonlyMap<string, string>
}

export interface ConvertResult {
  markdown: string
  /** Type names of blocks kept as placeholders, once each, in order. */
  unsupported: string[]
  /** Images that could not be copied and were kept as links back. */
  missingImages: number
}

// ── Block types ─────────────────────────────────────────────────────────────

export const FEISHU_BLOCK_TYPE_NAMES: Readonly<Record<number, string>> = {
  1: 'page',
  2: 'text',
  3: 'heading1',
  4: 'heading2',
  5: 'heading3',
  6: 'heading4',
  7: 'heading5',
  8: 'heading6',
  9: 'heading7',
  10: 'heading8',
  11: 'heading9',
  12: 'bullet',
  13: 'ordered',
  14: 'code',
  15: 'quote',
  17: 'todo',
  18: 'bitable',
  19: 'callout',
  20: 'chat_card',
  21: 'diagram',
  22: 'divider',
  23: 'file',
  24: 'grid',
  25: 'grid_column',
  26: 'iframe',
  27: 'image',
  28: 'isv',
  29: 'mindnote',
  30: 'sheet',
  31: 'table',
  32: 'table_cell',
  33: 'view',
  34: 'quote_container',
  35: 'task',
  36: 'okr',
  37: 'okr_objective',
  38: 'okr_key_result',
  39: 'okr_progress',
  40: 'add_ons',
  41: 'jira_issue',
  42: 'wiki_catalog',
  43: 'board',
  44: 'agenda',
  45: 'agenda_item',
  46: 'agenda_item_title',
  47: 'agenda_item_content',
  48: 'link_preview',
  49: 'source_synced',
  50: 'reference_synced',
  51: 'sub_page_list',
  52: 'ai_template',
  999: 'undefined',
}

/** CodeLanguage enum (1–75) → fence info string; PlainText has none. */
const CODE_LANGUAGES: Readonly<Record<number, string>> = {
  2: 'abap',
  3: 'ada',
  4: 'apache',
  5: 'apex',
  6: 'assembly',
  7: 'bash',
  8: 'csharp',
  9: 'cpp',
  10: 'c',
  11: 'cobol',
  12: 'css',
  13: 'coffeescript',
  14: 'd',
  15: 'dart',
  16: 'delphi',
  17: 'django',
  18: 'dockerfile',
  19: 'erlang',
  20: 'fortran',
  21: 'foxpro',
  22: 'go',
  23: 'groovy',
  24: 'html',
  25: 'handlebars',
  26: 'http',
  27: 'haskell',
  28: 'json',
  29: 'java',
  30: 'javascript',
  31: 'julia',
  32: 'kotlin',
  33: 'latex',
  34: 'lisp',
  35: 'logo',
  36: 'lua',
  37: 'matlab',
  38: 'makefile',
  39: 'markdown',
  40: 'nginx',
  41: 'objectivec',
  42: 'openedge',
  43: 'php',
  44: 'perl',
  45: 'postscript',
  46: 'powershell',
  47: 'prolog',
  48: 'protobuf',
  49: 'python',
  50: 'r',
  51: 'rpg',
  52: 'ruby',
  53: 'rust',
  54: 'sas',
  55: 'scss',
  56: 'sql',
  57: 'scala',
  58: 'scheme',
  59: 'scratch',
  60: 'shell',
  61: 'swift',
  62: 'thrift',
  63: 'typescript',
  64: 'vbscript',
  65: 'vb',
  66: 'xml',
  67: 'yaml',
  68: 'cmake',
  69: 'diff',
  70: 'gherkin',
  71: 'graphql',
  72: 'glsl',
  73: 'properties',
  74: 'solidity',
  75: 'toml',
}

const HEADING_MIN = 3
const HEADING_MAX = 11
/** Containers whose children are kept inline, unwrapped. */
const PASS_THROUGH = new Set([24, 25, 49, 50])
/** Recursion guard against a malformed (cyclic / absurdly deep) tree. */
const MAX_DEPTH = 40

// ── Inline text ─────────────────────────────────────────────────────────────

/** Backslash-escape the characters that open inline markdown constructs. */
export function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_[\]<>|~&]/g, ch => `\\${ch}`)
}

/** A line that would otherwise start a block construct (heading, list, …). */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)([#>+=-])/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3')
}

function clean(text: string): string {
  // Keep newlines and tabs; strip every other control character.
  return sanitizeField(text.replace(/\r\n?/g, '\n'))
}

/**
 * A link target Lumo is willing to render: http(s) or mailto only, with the
 * characters that would end a markdown link destination percent-encoded.
 * Feishu sends link URLs URL-encoded.
 */
export function safeLinkUrl(raw: string | undefined): string | null {
  if (!raw) return null
  let decoded = raw.trim()
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // Not encoded (or malformed encoding) — judge it as given.
  }
  let url: URL
  try {
    url = new URL(decoded)
  } catch {
    return null
  }
  if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null
  return url.href.replace(
    /[ ()<>]/g,
    ch => `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`
  )
}

function codeSpan(content: string): string {
  const longest = Math.max(
    0,
    ...(content.match(/`+/g) ?? []).map(run => run.length)
  )
  const fence = '`'.repeat(longest + 1)
  const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${content}${pad}${fence}`
}

interface Run {
  text: string
  /** Already-final markdown (code spans, mentions) — never re-escaped. */
  literal: boolean
  style: FeishuTextStyle
}

function styleKey(s: FeishuTextStyle): string {
  return [
    s.bold ? 'b' : '',
    s.italic ? 'i' : '',
    s.strikethrough ? 's' : '',
    s.inline_code ? 'c' : '',
    s.link?.url ?? '',
  ].join('|')
}

function wrapStyled(run: Run): string {
  const s = run.style
  if (s.inline_code && !run.literal) {
    return wrapLink(codeSpan(run.text.replace(/\n/g, ' ')), s)
  }
  const body = run.literal ? run.text : escapeMarkdownText(run.text)
  // Emphasis delimiters must hug non-space text: keep edge spaces outside.
  const m = body.match(/^(\s*)([\s\S]*?)(\s*)$/)
  const [, lead = '', core = '', trail = ''] = m ?? []
  if (!core) return body
  let out = core
  if (s.strikethrough) out = `~~${out}~~`
  if (s.italic) out = `*${out}*`
  if (s.bold) out = `**${out}**`
  return `${lead}${wrapLink(out, s)}${trail}`
}

function wrapLink(text: string, s: FeishuTextStyle): string {
  const href = safeLinkUrl(s.link?.url)
  return href ? `[${text}](${href})` : text
}

function reminderDate(raw: string | number | undefined): string {
  const ms = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/** One block's text elements as a single markdown string (may contain \n). */
export function renderElements(elements: FeishuTextElement[] = []): string {
  const runs: Run[] = []
  for (const el of elements) {
    if (el.text_run) {
      runs.push({
        text: clean(el.text_run.content ?? ''),
        literal: false,
        style: el.text_run.text_element_style ?? {},
      })
    } else if (el.mention_doc) {
      const title = clean(el.mention_doc.title ?? '').trim()
      const href = safeLinkUrl(el.mention_doc.url)
      const label = escapeMarkdownText(title || href || 'Feishu document')
      runs.push({
        text: href ? `[${label}](${href})` : label,
        literal: true,
        style: {},
      })
    } else if (el.mention_user) {
      runs.push({ text: '@user', literal: false, style: {} })
    } else if (el.equation) {
      runs.push({
        text: codeSpan(clean(el.equation.content ?? '').trim()),
        literal: true,
        style: {},
      })
    } else if (el.reminder) {
      const date = reminderDate(el.reminder.expire_time)
      if (date) runs.push({ text: date, literal: false, style: {} })
    } else if (el.file) {
      runs.push({ text: '[attachment]', literal: false, style: {} })
    }
    // inline_block / undefined_element carry no text.
  }

  // Merge adjacent runs with the same style so `**a****b**` never appears.
  const merged: Run[] = []
  for (const run of runs) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      !prev.literal &&
      !run.literal &&
      styleKey(prev.style) === styleKey(run.style)
    ) {
      prev.text += run.text
    } else {
      merged.push({ ...run })
    }
  }

  const text = merged.map(wrapStyled).join('')
  // A soft line break inside a block becomes a markdown hard break.
  return text
    .split('\n')
    .map(escapeLineStart)
    .join('\\\n')
    .replace(/(\\\n)+$/, '')
}

function plainText(elements: FeishuTextElement[] = []): string {
  return elements
    .map(el => el.text_run?.content ?? el.equation?.content ?? '')
    .join('')
}

// ── Blocks ──────────────────────────────────────────────────────────────────

interface Chunk {
  text: string
  /** List items join with a single newline; everything else with a blank. */
  listItem: boolean
}

function textBody(block: FeishuBlock): FeishuTextBody {
  const name = FEISHU_BLOCK_TYPE_NAMES[block.block_type] ?? ''
  const body = block[name]
  return body && typeof body === 'object' ? (body as FeishuTextBody) : {}
}

function indent(text: string, by: string): string {
  return text
    .split('\n')
    .map(line => (line ? `${by}${line}` : line))
    .join('\n')
}

function quoteLines(text: string): string {
  return text
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')
}

function joinChunks(chunks: Chunk[]): string {
  let out = ''
  chunks.forEach((c, i) => {
    if (i > 0) out += chunks[i - 1]!.listItem && c.listItem ? '\n' : '\n\n'
    out += c.text
  })
  return out
}

class Converter {
  private readonly byId: Map<string, FeishuBlock>
  private readonly unsupported: string[] = []
  private missingImages = 0

  constructor(
    blocks: FeishuBlock[],
    private readonly opts: ConvertOptions
  ) {
    this.byId = new Map(blocks.map(b => [b.block_id, b]))
  }

  run(blocks: FeishuBlock[]): ConvertResult {
    const root =
      blocks.find(b => b.block_type === 1) ??
      blocks.find(b => !b.parent_id || !this.byId.has(b.parent_id))
    const topIds = root
      ? root.block_type === 1
        ? (root.children ?? [])
        : blocks
            .filter(b => !b.parent_id || !this.byId.has(b.parent_id))
            .map(b => b.block_id)
      : []
    const markdown = joinChunks(this.renderList(topIds, 0)).trim()
    return {
      markdown: markdown ? `${markdown}\n` : '',
      unsupported: this.unsupported,
      missingImages: this.missingImages,
    }
  }

  private children(block: FeishuBlock): string[] {
    return Array.isArray(block.children) ? block.children : []
  }

  private renderList(ids: string[], depth: number): Chunk[] {
    if (depth > MAX_DEPTH) return []
    const out: Chunk[] = []
    let orderedNext = 1
    let prevType = 0
    for (const id of ids) {
      const block = this.byId.get(id)
      if (!block) continue
      if (block.block_type === 13) {
        const seq = textBody(block).style?.sequence
        const n = seq && /^\d+$/.test(seq) ? parseInt(seq, 10) : null
        orderedNext = n ?? (prevType === 13 ? orderedNext : 1)
      }
      out.push(...this.renderBlock(block, depth, orderedNext))
      if (block.block_type === 13) orderedNext += 1
      prevType = block.block_type
    }
    return out
  }

  private nested(block: FeishuBlock, depth: number): string {
    return joinChunks(this.renderList(this.children(block), depth + 1))
  }

  private placeholder(name: string): Chunk {
    if (!this.unsupported.includes(name)) this.unsupported.push(name)
    return {
      text: `> Unsupported Feishu block (${escapeMarkdownText(name)}) — [open in Feishu](${this.opts.sourceUrl})`,
      listItem: false,
    }
  }

  private renderBlock(
    block: FeishuBlock,
    depth: number,
    orderedNumber: number
  ): Chunk[] {
    const t = block.block_type
    const name = FEISHU_BLOCK_TYPE_NAMES[t] ?? `type_${t}`

    if (t === 2) {
      const text = renderElements(textBody(block).elements)
      const kids = this.nested(block, depth)
      return [text, kids]
        .filter(Boolean)
        .map(s => ({ text: s, listItem: false }))
    }
    if (t >= HEADING_MIN && t <= HEADING_MAX) {
      const level = Math.min(t - 2, 6)
      const text = renderElements(textBody(block).elements).replace(
        /\\\n/g,
        ' '
      )
      if (!text.trim()) return []
      return [{ text: `${'#'.repeat(level)} ${text}`, listItem: false }]
    }
    if (t === 12 || t === 13 || t === 17) {
      const body = textBody(block)
      const marker =
        t === 12
          ? '- '
          : t === 13
            ? `${orderedNumber}. `
            : body.style?.done
              ? '- [x] '
              : '- [ ] '
      const pad = ' '.repeat(t === 13 ? marker.length : 2)
      const text = indent(renderElements(body.elements), pad).slice(pad.length)
      const kids = this.nested(block, depth)
      return [
        {
          text: `${marker}${text}${kids ? `\n${indent(kids, pad)}` : ''}`,
          listItem: true,
        },
      ]
    }
    if (t === 14) {
      const body = textBody(block)
      const code = clean(plainText(body.elements)).replace(/\n+$/, '')
      const longest = Math.max(
        2,
        ...(code.match(/`{3,}/g) ?? []).map(run => run.length)
      )
      const fence = '`'.repeat(longest + 1)
      const lang = CODE_LANGUAGES[body.style?.language ?? 1] ?? ''
      return [{ text: `${fence}${lang}\n${code}\n${fence}`, listItem: false }]
    }
    if (t === 15) {
      const text = renderElements(textBody(block).elements)
      return text ? [{ text: quoteLines(text), listItem: false }] : []
    }
    if (t === 19 || t === 34) {
      const kids = this.nested(block, depth)
      return kids ? [{ text: quoteLines(kids), listItem: false }] : []
    }
    if (t === 22) return [{ text: '---', listItem: false }]
    if (t === 27) return [this.renderImage(block)]
    if (t === 31) return [this.renderTable(block, depth)]
    if (PASS_THROUGH.has(t)) {
      const kids = this.renderList(this.children(block), depth + 1)
      if (kids.length > 0 || t !== 50) return kids
      return [this.placeholder(name)]
    }
    return [this.placeholder(name)]
  }

  private renderImage(block: FeishuBlock): Chunk {
    const image = (block.image ?? {}) as {
      token?: string
      caption?: { content?: string }
    }
    const url = image.token ? this.opts.imageUrls?.get(image.token) : undefined
    const caption = escapeMarkdownText(
      clean(image.caption?.content ?? '')
        .replace(/\n/g, ' ')
        .trim()
    )
    if (url) return { text: `![${caption}](${url})`, listItem: false }
    this.missingImages += 1
    return {
      text: `[Image${caption ? `: ${caption}` : ''} — open in Feishu](${this.opts.sourceUrl})`,
      listItem: false,
    }
  }

  private cellText(cellId: string, depth: number): string {
    const cell = this.byId.get(cellId)
    if (!cell) return ''
    return joinChunks(this.renderList(this.children(cell), depth + 1))
      .replace(/\\\n/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\|/g, '\\|')
      .replace(/\\\\\|/g, '\\|')
      .trim()
  }

  private renderTable(block: FeishuBlock, depth: number): Chunk {
    const table = (block.table ?? {}) as {
      cells?: string[]
      property?: { row_size?: number; column_size?: number }
    }
    const cells = Array.isArray(table.cells) ? table.cells : []
    const cols = Math.max(1, table.property?.column_size ?? 1)
    const rows = Math.max(
      1,
      table.property?.row_size ?? Math.ceil(cells.length / cols)
    )
    const lines: string[] = []
    for (let r = 0; r < rows; r++) {
      const row: string[] = []
      for (let c = 0; c < cols; c++) {
        const id = cells[r * cols + c]
        row.push(id ? this.cellText(id, depth) : '')
      }
      lines.push(`| ${row.join(' | ')} |`)
      if (r === 0) lines.push(`|${' --- |'.repeat(cols)}`)
    }
    return { text: lines.join('\n'), listItem: false }
  }
}

/** Convert a docx block list (as `listDocxBlocks` returns it) to markdown. */
export function feishuBlocksToMarkdown(
  blocks: FeishuBlock[],
  opts: ConvertOptions
): ConvertResult {
  return new Converter(blocks, opts).run(blocks)
}

/** Image tokens in document order (for the import service to copy). */
export function collectImageTokens(blocks: FeishuBlock[]): string[] {
  const out: string[] = []
  for (const b of blocks) {
    if (b.block_type !== 27) continue
    const token = (b.image as { token?: unknown } | undefined)?.token
    if (typeof token === 'string' && token && !out.includes(token)) {
      out.push(token)
    }
  }
  return out
}
