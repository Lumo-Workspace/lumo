import * as path from 'path'
import { fileURLToPath } from 'url'
import {
  AGENT_REVIEW_TOOLS,
  type AgentReviewTool,
} from '../../../shared/src/security-scan'

/**
 * LUM-1321 — what `lumo review import` reads: SARIF 2.1.0 as it is (e.g.
 * a Codex Security export), or the small Lumo JSON an agent writes after a
 * security review:
 *
 *   { "findings": [ { "file", "line", "severity", "title", "detail"?, "rule"? } ] }
 *
 * Either way the server gets SARIF with repository-relative paths. The
 * server's parser is the authority on the SARIF itself; this only catches
 * what the user can fix before anything is sent.
 */

export { AGENT_REVIEW_TOOLS, type AgentReviewTool }

/** The server keeps at most this many results of one report. */
export const AGENT_REVIEW_MAX_FINDINGS = 500

const MAX_TITLE = 200
const MAX_DETAIL = 4000

/** severity → SARIF level + `security-severity` (the server reads the score). */
const SEVERITY = {
  high: { level: 'error', score: '8.0' },
  medium: { level: 'warning', score: '5.0' },
  low: { level: 'note', score: '2.0' },
} as const
type Severity = keyof typeof SEVERITY

export type ImportSarifResult =
  | { ok: true; sarif: Record<string, unknown>; results: number }
  | { ok: false; error: string }

/**
 * The coding agent this shell runs in. Codex first: a Codex shell may
 * inherit a parent Claude Code session's id (the same order as the session
 * id, `cli/skill/references/codex.md`).
 */
export function detectAgentTool(
  env: Record<string, string | undefined>
): AgentReviewTool | null {
  if (env['CODEX_THREAD_ID'] || env['CODEX_SESSION_ID']) return 'codex'
  if (env['CLAUDE_CODE_SESSION_ID']) return 'claude-code'
  return null
}

/** A local path for `file`: a path as is, a `file:` URI decoded; null for anything else. */
function localPath(file: string): string | null {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(file) || /^[a-z]:[\\/]/i.test(file))
    return file // a path (a Windows drive letter is not a scheme)
  if (!/^file:/i.test(file)) return null // https:, git:, …
  try {
    return fileURLToPath(file) // localhost, %20, Windows drives
  } catch (err) {
    // Another machine's file is not in this checkout.
    if ((err as { code?: string }).code === 'ERR_INVALID_FILE_URL_HOST')
      return null
    // A malformed escape (`100%.ts`): use the path as written.
    return file.replace(/^file:\/\/(localhost)?/i, '')
  }
}

/** `path` relative to `root`, or null when it is outside the repository. */
function repoRelative(file: string, root: string): string | null {
  const local = localPath(file)
  if (local === null) return null
  const abs = path.resolve(root, local)
  const rel = path.relative(root, abs)
  if (
    rel === '' ||
    rel === '..' ||
    rel.startsWith(`..${path.sep}`) ||
    path.isAbsolute(rel)
  )
    return null
  return rel.split(path.sep).join('/')
}

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, '')
  return s || 'finding'
}

/** `command-injection` → `Command injection`. */
function humanize(ruleId: string): string {
  const words = ruleId.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fromLumoJson(findings: unknown[], root: string): ImportSarifResult {
  if (findings.length > AGENT_REVIEW_MAX_FINDINGS)
    return {
      ok: false,
      error: `${findings.length} findings — at most ${AGENT_REVIEW_MAX_FINDINGS} per import`,
    }
  const parsed: Array<{
    ruleId: string
    uri: string
    line: number
    sev: Severity
    title: string
    detail: string
  }> = []
  for (const [i, raw] of findings.entries()) {
    const at = `findings[${i}]`
    if (!isRecord(raw)) return { ok: false, error: `${at} is not an object` }
    const file = raw['file']
    if (typeof file !== 'string' || file.trim() === '')
      return { ok: false, error: `${at}.file must be a repository path` }
    const uri = repoRelative(file.trim(), root)
    if (uri === null)
      return {
        ok: false,
        error: `${at}.file ${file} is outside the repository`,
      }
    const line = raw['line']
    if (typeof line !== 'number' || !Number.isInteger(line) || line < 1)
      return {
        ok: false,
        error: `${at}.line must be a line number (1 or more)`,
      }
    const sevRaw = String(raw['severity'] ?? '').toLowerCase()
    const sev = (sevRaw === 'critical' ? 'high' : sevRaw) as Severity
    if (!Object.prototype.hasOwnProperty.call(SEVERITY, sev))
      return {
        ok: false,
        error: `${at}.severity must be high, medium or low (got ${JSON.stringify(raw['severity'] ?? null)})`,
      }
    const title = typeof raw['title'] === 'string' ? raw['title'].trim() : ''
    if (title === '') return { ok: false, error: `${at}.title is empty` }
    const detail = typeof raw['detail'] === 'string' ? raw['detail'].trim() : ''
    const ruleId =
      typeof raw['rule'] === 'string' && raw['rule'].trim() !== ''
        ? slug(raw['rule'])
        : slug(title)
    parsed.push({
      ruleId,
      uri,
      line,
      sev,
      title: clip(title, MAX_TITLE),
      detail: clip(detail, MAX_DETAIL),
    })
  }
  // The PR comment heads with the rule's description and shows the message
  // under it. A rule with one title describes itself by it, and its messages
  // carry the detail alone; a rule shared by differently titled findings is
  // described by its name, and each message leads with its own title.
  const titles = new Map<string, Set<string>>()
  for (const p of parsed)
    titles.set(p.ruleId, (titles.get(p.ruleId) ?? new Set()).add(p.title))
  const rules = new Map<string, string>()
  for (const [id, set] of titles)
    rules.set(id, set.size === 1 ? [...set][0]! : humanize(id))
  const results = parsed.map(p => {
    const own = titles.get(p.ruleId)!.size === 1
    const text = own
      ? p.detail || p.title
      : p.detail
        ? `${p.title}\n\n${p.detail}`
        : p.title
    return {
      ruleId: p.ruleId,
      level: SEVERITY[p.sev].level,
      message: { text },
      properties: { 'security-severity': SEVERITY[p.sev].score },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: p.uri },
            region: { startLine: p.line },
          },
        },
      ],
    }
  })
  return {
    ok: true,
    results: results.length,
    sarif: {
      version: '2.1.0',
      runs: [
        {
          // The server renames the tool to the agent's slug.
          tool: {
            driver: {
              name: 'lumo-import',
              rules: [...rules].map(([id, text]) => ({
                id,
                shortDescription: { text },
              })),
            },
          },
          results,
        },
      ],
    },
  }
}

/** SARIF as given, with every location's URI made repository-relative. */
function fromSarif(
  doc: Record<string, unknown>,
  root: string
): ImportSarifResult {
  if (doc['version'] !== '2.1.0' || !Array.isArray(doc['runs']))
    return { ok: false, error: 'only SARIF 2.1.0 is accepted' }
  const outside: string[] = []
  let count = 0
  const runs = doc['runs'].map((run: unknown) => {
    if (!isRecord(run) || !Array.isArray(run['results'])) return run
    const results = run['results'].map((res: unknown) => {
      count += 1
      if (!isRecord(res) || !Array.isArray(res['locations'])) return res
      return {
        ...res,
        locations: res['locations'].map((loc: unknown) => {
          const phys = isRecord(loc) ? loc['physicalLocation'] : null
          const art = isRecord(phys) ? phys['artifactLocation'] : null
          const uri = isRecord(art) ? art['uri'] : null
          if (typeof uri !== 'string') return loc
          const rel = repoRelative(uri, root)
          if (rel === null) {
            outside.push(uri)
            return loc
          }
          return {
            ...(loc as Record<string, unknown>),
            physicalLocation: {
              ...(phys as Record<string, unknown>),
              artifactLocation: {
                ...(art as Record<string, unknown>),
                uri: rel,
              },
            },
          }
        }),
      }
    })
    return { ...run, results }
  })
  if (outside.length > 0)
    return {
      ok: false,
      error: `${outside.length} result location${outside.length === 1 ? ' is' : 's are'} outside the repository (first: ${outside[0]}) — run the export from this checkout`,
    }
  if (count > AGENT_REVIEW_MAX_FINDINGS)
    return {
      ok: false,
      error: `${count} results — at most ${AGENT_REVIEW_MAX_FINDINGS} per import`,
    }
  return { ok: true, results: count, sarif: { ...doc, runs } }
}

/** Parse the file's text into the SARIF the import sends. */
export function toImportSarif(text: string, root: string): ImportSarifResult {
  let doc: unknown
  try {
    doc = JSON.parse(text)
  } catch {
    return { ok: false, error: 'the file is not valid JSON' }
  }
  if (Array.isArray(doc)) return fromLumoJson(doc, root)
  if (!isRecord(doc))
    return { ok: false, error: 'expected SARIF 2.1.0 or { "findings": [...] }' }
  if ('runs' in doc || 'version' in doc) return fromSarif(doc, root)
  if (Array.isArray(doc['findings'])) return fromLumoJson(doc['findings'], root)
  return {
    ok: false,
    error: 'expected SARIF 2.1.0 or { "findings": [...] } (no findings array)',
  }
}
