import * as path from 'path'
import {
  AGENT_REVIEW_TOOLS,
  type AgentReviewTool,
} from '../../../shared/src/security-scan'

/**
 * LUM-1321 — what `lumo security import` reads: SARIF 2.1.0 as it is (e.g.
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

/** `path` relative to `root`, or null when it is outside the repository. */
function repoRelative(file: string, root: string): string | null {
  const stripped = file.startsWith('file://')
    ? decodeURIComponent(file.slice('file://'.length))
    : file
  const abs = path.resolve(root, stripped)
  const rel = path.relative(root, abs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
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
  const rules = new Map<string, string>()
  const results: unknown[] = []
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
    if (!(sev in SEVERITY))
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
    const shortTitle = clip(title, MAX_TITLE)
    if (!rules.has(ruleId)) rules.set(ruleId, shortTitle)
    results.push({
      ruleId,
      level: SEVERITY[sev].level,
      message: {
        text: detail
          ? `${shortTitle}\n\n${clip(detail, MAX_DETAIL)}`
          : shortTitle,
      },
      properties: { 'security-severity': SEVERITY[sev].score },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri },
            region: { startLine: line },
          },
        },
      ],
    })
  }
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
          if (rel === null) return loc
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
