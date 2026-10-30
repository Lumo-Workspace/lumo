/**
 * LUM-1343 — parse a Feishu / Lark document URL.
 *
 * Tenant URLs look like `https://<tenant>.feishu.cn/docx/<token>` or
 * `https://<tenant>.larksuite.com/wiki/<token>` (also `larkoffice.com`, the
 * newer Feishu host). The path segment names the object type; a `/wiki/`
 * node is a knowledge-base entry whose real object type is only known after
 * `wiki/v2/spaces/get_node` (lib/integrations/feishu/docx-api.ts).
 */

/** Hosts a Feishu / Lark document can live on (the tenant subdomain varies). */
const FEISHU_HOST_RE =
  /(^|\.)(feishu\.cn|feishu\.net|larksuite\.com|larkoffice\.com|larksuite-boe\.com)$/i

/** Feishu tokens: letters and digits (docx ids are 27 chars). */
const TOKEN_RE = /^[A-Za-z0-9]{8,64}$/

/** Object types Lumo refuses with a clear "not supported" error. */
export type FeishuUnsupportedKind =
  | 'doc'
  | 'sheet'
  | 'bitable'
  | 'slides'
  | 'mindnote'
  | 'whiteboard'
  | 'file'

export type FeishuDocRef =
  | { kind: 'docx'; token: string; url: string }
  | { kind: 'wiki'; token: string; url: string }
  | { kind: 'unsupported'; type: FeishuUnsupportedKind; url: string }

const PATH_KIND: Record<string, 'docx' | 'wiki' | FeishuUnsupportedKind> = {
  docx: 'docx',
  wiki: 'wiki',
  docs: 'doc',
  doc: 'doc',
  sheets: 'sheet',
  sheet: 'sheet',
  base: 'bitable',
  bitable: 'bitable',
  slides: 'slides',
  mindnotes: 'mindnote',
  mindnote: 'mindnote',
  board: 'whiteboard',
  whiteboard: 'whiteboard',
  file: 'file',
}

/**
 * The document a URL points at, or null when it is not a Feishu / Lark
 * document URL at all (malformed, another host, no token). Only https URLs
 * are accepted; the returned `url` is the canonical
 * `https://<host>/<type>/<token>` with query and hash dropped, safe to store
 * and render as a link back.
 */
export function parseFeishuDocUrl(input: string): FeishuDocRef | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password || url.port) return null
  if (!FEISHU_HOST_RE.test(url.hostname)) return null
  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const [rawType, token] = segments as [string, string]
  const kind = PATH_KIND[rawType.toLowerCase()]
  if (!kind || !TOKEN_RE.test(token)) return null
  const canonical = `https://${url.hostname.toLowerCase()}/${rawType.toLowerCase()}/${token}`
  if (kind === 'docx' || kind === 'wiki') {
    return { kind, token, url: canonical }
  }
  return { kind: 'unsupported', type: kind, url: canonical }
}

/**
 * Map a wiki node's `obj_type` (get_node response) to what Lumo can import.
 * Documented values: doc, docx, sheet, mindnote, bitable, file, slides.
 */
export function wikiObjKind(objType: string): 'docx' | FeishuUnsupportedKind {
  switch (objType) {
    case 'docx':
      return 'docx'
    case 'doc':
    case 'sheet':
    case 'bitable':
    case 'slides':
    case 'mindnote':
    case 'file':
      return objType
    default:
      // Anything new (e.g. a whiteboard node) is refused, never guessed.
      return 'file'
  }
}
