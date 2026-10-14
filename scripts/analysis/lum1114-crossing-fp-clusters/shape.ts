/**
 * LUM-1114 — the "shape" of a crossing: what kind of command or code tripped
 * it, with every instance-specific value (paths, URLs, ids, quoted text,
 * numbers) folded to a placeholder. Crossings with the same category + shape
 * are one false-positive pattern; a pattern is what a detector fix removes.
 * Pure.
 *
 * Reads the crossing's `target` first — for the action classes it is the
 * matched shell segment (LUM-477), i.e. already the offending part of the
 * line — and falls back to `detail`. Known verdict prefixes the detector
 * prepends (advisory notes, the evasion marker) are stripped.
 */
import {
  isNonPublicHost,
  literalUrlHosts,
} from '@/lib/boundary-crossing/url-hosts'

/** Tokens kept per shape: enough for verb + subcommand + the telling flags. */
const MAX_TOKENS = 6

const VERDICT_PREFIXES = [
  /^\[base64-decoded\]\s*/,
  /^No tracked test file is missing after this command[^—]*— advisory —\s*/,
  /^Tracked test file\(s\) missing after this command:[^—]*—\s*/,
  /^Stops only processes this session started — advisory —\s*/,
]

/** A written / read file, by the kind that decides whether it is noise. */
function fileKind(path: string): string {
  const p = path.replace(/\s*\(.*$/, '').replace(/…$/, '')
  if (/(?:^|\/)__tests__\/|\.(?:test|spec)\.[a-z]+$/i.test(p))
    return 'test file'
  if (/(?:^|\/)\.env(?:\.|$)/.test(p)) return '.env*'
  if (/(?:^|\/)prisma\/schema\.prisma$/.test(p)) return 'prisma/schema.prisma'
  if (/(?:^|\/)prisma\/migrations\//.test(p)) return 'prisma/migrations/*'
  if (/^~|\/\.[a-z]+\//i.test(p)) return 'dotfile/home config'
  const ext = /\.[a-z0-9]+$/i.exec(p)?.[0]
  return ext ? `*${ext}` : '<noext>'
}

/** Category-specific shapes where the text is not a command. */
function nonCommandShape(category: string, text: string): string | null {
  if (category === 'PROJECT_RULE_VIOLATION') {
    // One rule, one fix — the rule text splits these further (cluster.ts);
    // the shape only says whether a code rule or an action rule fired.
    const kind = /\b(coderule|actionrule):/.exec(text)?.[1]
    if (kind) return kind
  }
  if (category === 'POLICY_WEAKENING')
    return /UNCHANGED/.test(text)
      ? 'weakening (rule text unchanged)'
      : 'weakening'
  if (
    category === 'HARDCODED_SECRET' ||
    category === 'SENSITIVE_PATH_EDIT' ||
    category === 'SENSITIVE_PATH_READ'
  ) {
    // "<pattern title> in <file>", "edited sensitive path <file> …", or a
    // purged "<file>" — keep the pattern (if any) and the file kind.
    const m = /^(.*?)\s+(?:in|written to)\s+(\S+)/.exec(text)
    if (m) return `${(m[1] ?? '').trim()} in ${fileKind(m[2] ?? '')}`
    const path = /(\S*[/~]\S+)/.exec(text)?.[1]
    if (path) return fileKind(path)
  }
  if (text.startsWith('coderule:')) return text.split(':').slice(0, 2).join(':')
  return null
}

function foldUrl(url: string): string {
  const host = literalUrlHosts(url)[0] ?? ''
  return isNonPublicHost(host) ? '<url:local>' : '<url:public>'
}

function foldToken(tok: string): string {
  if (/^https?:\/\//i.test(tok)) return foldUrl(tok)
  if (/^['"].*['"]$/.test(tok)) return '<str>'
  if (/^-{1,2}[A-Za-z][\w-]*=/.test(tok)) return `${tok.split('=')[0]}=<v>`
  if (/^-/.test(tok)) return tok
  if (/^@/.test(tok)) return '@<path>'
  if (/^\d+$/.test(tok)) return '<n>'
  if (/^[0-9a-f]{7,}$/i.test(tok) || /^c[a-z0-9]{20,}$/.test(tok)) return '<id>'
  if (/[/\\]/.test(tok) || /\.[a-z0-9]{1,5}$/i.test(tok)) return '<path>'
  if (/^\$/.test(tok)) return '<var>'
  return tok
}

/** Shell-ish tokens, keeping quoted spans whole. */
function tokens(text: string): string[] {
  return text.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
}

/**
 * The text a shape is read from. The target first — for the action classes it
 * is the matched segment — unless it is a LUM-912 purge hash (`sha256:…`) or
 * the path the detail also carries; then the detail, minus the
 * `<CATEGORY> · ` prefix and the `$ ` / `…` a code-free summary wraps a
 * command in. Empty when only the category survived the purge.
 */
function readableText(input: {
  category: string
  target: string | null
  detail: string
}): string {
  const target = input.target?.trim() ?? ''
  const useDetail =
    !target ||
    target.startsWith('sha256:') ||
    input.category === 'HARDCODED_SECRET' ||
    input.category === 'POLICY_WEAKENING'
  let text = stripVerdictPrefixes(useDetail ? input.detail : target)
  const prefix = `${input.category} · `
  if (text.startsWith(prefix)) text = text.slice(prefix.length)
  if (text === input.category) return ''
  return text
    .replace(/^\$\s+/, '')
    .replace(/\s*…$/, '')
    .trim()
}

export function stripVerdictPrefixes(text: string): string {
  let out = text.trim()
  for (const re of VERDICT_PREFIXES) out = out.replace(re, '')
  return out
}

export function crossingShape(input: {
  category: string
  target: string | null
  detail: string
}): string {
  const raw = readableText(input)
  if (!raw) return '<purged>'
  const special = nonCommandShape(input.category, raw)
  if (special) return special
  // The first segment is the one the matcher fingerprinted (target), or the
  // start of the command (detail). A leading `cd <dir>` segment is skipped and
  // leading `NAME=value` env assignments are dropped — both are noise here.
  const segments = raw.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean)
  const first =
    segments.find(seg => !/^cd(?:\s|$)/.test(seg.trim())) ?? segments[0] ?? raw
  const toks = tokens(first)
  const start = toks.findIndex(t => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t))
  const folded = toks.slice(start === -1 ? toks.length : start).map(foldToken)
  return folded.slice(0, MAX_TOKENS).join(' ') || '<empty>'
}
