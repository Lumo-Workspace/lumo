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

/** Category-specific shapes where the text is not a command. */
function nonCommandShape(category: string, text: string): string | null {
  if (category === 'HARDCODED_SECRET') {
    // "<pattern title> in <file>" — keep the pattern and the file extension.
    const m = /^(.*?)\s+(?:in|written to)\s+(\S+)/.exec(text)
    if (!m) return null
    const ext = /\.[a-z0-9]+$/i.exec(m[2] ?? '')?.[0] ?? '<noext>'
    return `${(m[1] ?? '').trim()} in *${ext}`
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
  const raw = stripVerdictPrefixes(input.target?.trim() || input.detail)
  const special = nonCommandShape(input.category, raw)
  if (special) return special
  // The first segment is the one the matcher fingerprinted (target), or the
  // start of the command (detail).
  const first = raw.split(/\s*(?:&&|\|\||;|\|)\s*/)[0] ?? raw
  const folded = tokens(first)
    .map(foldToken)
    // Leading env assignments and `cd <dir>` are noise for the shape.
    .filter((t, i, all) => !(i === 0 && /^[A-Z_]+=/.test(t)) && all.length > 0)
  return folded.slice(0, MAX_TOKENS).join(' ') || '<empty>'
}
