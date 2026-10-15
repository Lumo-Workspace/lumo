/**
 * LUM-1199 — a benchmark repository's OWN guidelines (review docs, agent
 * docs, CONTRIBUTING, glob-scoped rule files, a review config file with
 * `reviews.path_instructions`) as LUM-1147 path instructions. PURE and
 * deterministic: the same files give the same list, so the mapping can be
 * reviewed as code instead of per-repo hand edits.
 *
 * Mapping (a judgement call, stated once here):
 *  - a review config file at the root (`.lumo.yaml` or any root `.*.yaml`
 *    with `reviews.path_instructions`) — its entries as written, first;
 *  - the whole-repo docs (REVIEW*.md, AGENTS/CLAUDE/GEMINI.md, copilot
 *    instructions, `.cursorrules`, an always-applied rule file,
 *    CONTRIBUTING) — their most rule-like lines pooled into ONE `**` entry
 *    (one entry per glob is all the feature keeps), review docs first;
 *  - rule files that name globs (`globs:` / `applyTo:`) — one entry per glob;
 *  - nested AGENTS/CLAUDE/GEMINI/CONTRIBUTING docs — `<dir>/**`, shallow
 *    first.
 * Then the production normalisation (`normalizePathInstructions`: 20
 * entries, 1,000 characters each). Nothing is invented: a repo without such
 * files gets no instructions.
 *
 * The text is third-party and untrusted: it only ever goes to the scratch
 * dir and, in the replay, through the production rendering
 * (`planPathInstructions` + `guardPromptLineText`).
 */
import { parse as parseYaml } from 'yaml'
import {
  PATH_INSTRUCTION_MAX_CHARS,
  normalizePathInstructions,
  oneLine,
  type PathInstruction,
} from '@/ee/security/security-scan/path-instructions'

export type GuidelineKind =
  | 'review-config'
  | 'review-doc'
  | 'agent'
  | 'contributing'
  | 'scoped-rule'
  | 'scoped-doc'

export interface GuidelineClass {
  kind: GuidelineKind
  /** The glob the file applies to; null = read from the file itself. */
  scope: string | null
}

const REVIEW_DOC =
  /^(review|reviewing|review[-_]guide|review[-_]guidelines|code[-_]review)\.md$/i
const AGENT_DOC = /^(agents|claude|gemini)\.md$/i
const CONTRIBUTING = /^contributing(\.md|\.rst|\.txt)?$/i
/** Directories whose docs are product content or fixtures, not guidelines. */
const SKIPPED_SEGMENT =
  /^(\..*|tests?|testdata|fixtures|__fixtures__|__corpus__|examples?|templates?|assets|files|vendor|third[-_]party|node_modules)$/i

/** PURE — what a repository file is to the extraction (null = not a guideline). */
export function classifyGuidelineFile(p: string): GuidelineClass | null {
  const parts = p.split('/')
  const base = parts[parts.length - 1]!
  const dir = parts.slice(0, -1).join('/')
  if (parts.length === 1) {
    if (/^\..+\.ya?ml$/i.test(base))
      return { kind: 'review-config', scope: null }
    if (REVIEW_DOC.test(base)) return { kind: 'review-doc', scope: '**' }
    if (AGENT_DOC.test(base)) return { kind: 'agent', scope: '**' }
    if (/^\.(cursorrules|windsurfrules)$/i.test(base))
      return { kind: 'agent', scope: '**' }
    if (CONTRIBUTING.test(base)) return { kind: 'contributing', scope: '**' }
    return null
  }
  if (dir === '.github') {
    if (REVIEW_DOC.test(base)) return { kind: 'review-doc', scope: '**' }
    if (/^copilot-instructions\.md$/i.test(base))
      return { kind: 'agent', scope: '**' }
    if (CONTRIBUTING.test(base)) return { kind: 'contributing', scope: '**' }
    return null
  }
  if (dir === '.claude' && /^claude\.md$/i.test(base))
    return { kind: 'agent', scope: '**' }
  if (dir === 'docs') {
    if (REVIEW_DOC.test(base)) return { kind: 'review-doc', scope: '**' }
    if (CONTRIBUTING.test(base)) return { kind: 'contributing', scope: '**' }
    return null
  }
  if (dir === '.cursor/rules' && /\.mdc$/i.test(base))
    return { kind: 'scoped-rule', scope: null }
  if (dir === '.github/instructions' && /\.instructions\.md$/i.test(base))
    return { kind: 'scoped-rule', scope: null }
  if (parts.slice(0, -1).some(s => SKIPPED_SEGMENT.test(s))) return null
  if (AGENT_DOC.test(base)) return { kind: 'scoped-doc', scope: `${dir}/**` }
  // A nested CONTRIBUTING under docs/ is a site page (often a translation).
  if (CONTRIBUTING.test(base) && !parts.includes('docs'))
    return { kind: 'scoped-doc', scope: `${dir}/**` }
  return null
}

// ------------------------------------------------------------ markdown → rules

/** A heading that introduces setup / process text, not review guidance. */
const DROP_HEADING =
  /\b(install(ation|ing)?|setup|set up|getting started|quick ?start|prerequisites?|build(ing)?|commands?|scripts?|running|release|releasing|publish(ing)?|deploy(ment|ing)?|licen[cs]e|community|code of conduct|reporting|issues?|bugs?|support|commits?|branch(es|ing)?|pull requests?|pr titles?|conventional commits?|changelog|contact|sponsors?|acknowledg\w*|table of contents|contents|environment|docker|ci|workflows?|git|discussions?|help|faq|links?|resources|credits|thanks)\b/i
const KEEP_HEADING =
  /(convention|guideline|rule|standard|style|practice|pattern|principle|review|quality|test|security|error|naming|architecture|gotcha|pitfall|invariant|constraint|do'?s|don'?t)/i
const DIRECTIVE =
  /\b(must|never|always|should|shall|do not|don't|avoid|prefer|ensure|required|requires?|only|instead|forbidden|mandatory|important)\b/i
/**
 * A line that is a command: one opening with a quoted tool invocation, or
 * "run <tool> …". A bare leading word is not enough — "Make sure …" and
 * "Go code must …" are rules.
 */
const COMMAND_LINE =
  /^(?:(?:run|execute)\s+`?|`)(npm|pnpm|yarn|bun|bunx|npx|cargo|go|make|mise|pip|uv|python3?|docker|git|just|nx|turbo|deno|node|gh)\b/i
const MIN_RULE_CHARS = 20
const MAX_RULE_CHARS = 400

export interface RuleLine {
  text: string
  score: number
}

/** The body without a leading `---` YAML front matter block, and that block parsed. */
export function splitFrontmatter(text: string): {
  data: Record<string, unknown>
  body: string
} {
  const t = text.replace(/\r\n?/g, '\n')
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t)
  if (!m) return { data: {}, body: t }
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = parseYaml(m[1]!)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      data = parsed as Record<string, unknown>
  } catch {
    data = {}
  }
  return { data, body: t.slice(m[0].length) }
}

function cleanInline(s: string): string {
  return oneLine(
    s
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\*\*|__(?=\S)|(?<=\S)__/g, '')
      .replace(/^>\s?/, '')
  )
}

function clip(s: string): string {
  if (s.length <= MAX_RULE_CHARS) return s
  const sentences = s.match(/[^.!?]+[.!?]+(\s|$)/g) ?? []
  let out = ''
  for (const x of sentences) {
    if (out.length + x.length > MAX_RULE_CHARS) break
    out += x
  }
  return out.trim()
}

/**
 * PURE — the rule-like blocks of a markdown guideline, in document order:
 * list items and paragraphs outside setup/process sections, without code
 * fences, tables, HTML comments or command lines; scored (+2 a directive
 * word, +1 a list item, +1 under a guideline-like heading).
 */
export function ruleLines(markdown: string): RuleLine[] {
  const body = splitFrontmatter(markdown).body.replace(/<!--[\s\S]*?-->/g, '')
  // Per heading level: true = keep, false = drop, null = neutral.
  const stack: Array<{ level: number; keep: boolean | null }> = []
  const effective = (): boolean | null => {
    for (let i = stack.length - 1; i >= 0; i--)
      if (stack[i]!.keep !== null) return stack[i]!.keep
    return null
  }
  const out: RuleLine[] = []
  let block: { text: string; list: boolean } | null = null
  const flush = () => {
    const b = block
    block = null
    if (!b) return
    const section = effective()
    const text = clip(cleanInline(b.text))
    if (section === false) return
    if (text.length < MIN_RULE_CHARS || COMMAND_LINE.test(text)) return
    // The lead-in to a list says nothing by itself.
    if (text.endsWith(':')) return
    const code = (text.match(/`[^`]*`/g) ?? []).join('').length
    if (code > text.length / 2) return
    let score = 0
    if (DIRECTIVE.test(text)) score += 2
    if (b.list) score += 1
    if (section === true) score += 1
    out.push({ text, score })
  }
  let fence: string | null = null
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\t/g, '  ')
    const fenceMark = /^\s*(```|~~~)/.exec(line)
    if (fence) {
      if (fenceMark && fenceMark[1] === fence) fence = null
      continue
    }
    if (fenceMark) {
      flush()
      fence = fenceMark[1]!
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      const level = heading[1]!.length
      const title = heading[2]!
      while (stack.length && stack[stack.length - 1]!.level >= level)
        stack.pop()
      const keep = KEEP_HEADING.test(title)
        ? true
        : DROP_HEADING.test(title)
          ? false
          : null
      stack.push({ level, keep })
      continue
    }
    if (
      line.trim() === '' ||
      /^\s*\|/.test(line) ||
      /^\s*([-*_])\1{2,}\s*$/.test(line)
    ) {
      flush()
      continue
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?(.*)$/.exec(line)
    if (item) {
      flush()
      block = { text: item[3]!, list: true }
      continue
    }
    if (block) block.text += ` ${line.trim()}`
    else block = { text: line.trim(), list: false }
  }
  flush()
  return out
}

/**
 * PURE — the highest-scoring lines that fit `max` characters (joined with
 * `; `), in document order; equal scores keep document order.
 */
export function packRules(
  lines: readonly RuleLine[],
  max = PATH_INSTRUCTION_MAX_CHARS
): string {
  const order = lines
    .map((l, i) => ({ ...l, i }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
  const picked: number[] = []
  let used = 0
  const seen = new Set<string>()
  for (const l of order) {
    if (seen.has(l.text)) continue
    const add = l.text.length + (picked.length > 0 ? 2 : 0)
    if (used + add > max) continue
    seen.add(l.text)
    picked.push(l.i)
    used += add
  }
  return picked
    .sort((a, b) => a - b)
    .map(i => lines[i]!.text)
    .join('; ')
}

// ------------------------------------------------------------ review config

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** PURE — `reviews.path_instructions` of a review config file (the `.lumo.yaml` shape). */
export function reviewConfigInstructions(yamlText: string): PathInstruction[] {
  let doc: unknown
  try {
    doc = parseYaml(yamlText)
  } catch {
    return []
  }
  if (!isRecord(doc) || !isRecord(doc.reviews)) return []
  const list = doc.reviews.path_instructions
  if (!Array.isArray(list)) return []
  return list
    .filter(isRecord)
    .filter(
      e => typeof e.path === 'string' && typeof e.instructions === 'string'
    )
    .map(e => ({
      path: (e.path as string).trim(),
      instructions: (e.instructions as string).trim(),
    }))
}

// ------------------------------------------------------------ the repo's list

export interface GuidelineDoc {
  /** Repository path. */
  path: string
  text: string
}

export interface GuidelineSourceReport {
  path: string
  kind: GuidelineKind
  /** Path instructions this file contributed before the entry cap. */
  entries: number
}

export interface RepoPathInstructions {
  instructions: PathInstruction[]
  sources: GuidelineSourceReport[]
  /** Entries cut by the production entry cap. */
  dropped: number
}

const POOL_BONUS: Partial<Record<GuidelineKind, number>> = {
  'review-doc': 3,
  agent: 1,
  contributing: 0,
}

function globsOf(v: unknown): string[] {
  const raw = Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string'
      ? v.split(',')
      : []
  return raw.map(g => g.trim()).filter(g => g.length > 0)
}

/** PURE — a repository's guideline files as its path-instruction list. */
export function buildRepoPathInstructions(
  docs: readonly GuidelineDoc[]
): RepoPathInstructions {
  const sorted = [...docs].sort((a, b) => (a.path < b.path ? -1 : 1))
  const config: PathInstruction[] = []
  const pool: Array<RuleLine & { order: number; k: number }> = []
  const rules: PathInstruction[] = []
  const nested: Array<PathInstruction & { depth: number; src: string }> = []
  const sources: GuidelineSourceReport[] = []
  let order = 0
  for (const doc of sorted) {
    const cls = classifyGuidelineFile(doc.path)
    if (!cls) continue
    const report: GuidelineSourceReport = {
      path: doc.path,
      kind: cls.kind,
      entries: 0,
    }
    if (cls.kind === 'review-config') {
      // Any root dot-YAML is a candidate; only one with the key is a source.
      const list = reviewConfigInstructions(doc.text)
      if (list.length === 0) continue
      config.push(...list)
      report.entries = list.length
      sources.push(report)
      continue
    }
    sources.push(report)
    const { data } = splitFrontmatter(doc.text)
    const lines = ruleLines(doc.text)
    if (lines.length === 0) continue
    if (cls.kind === 'scoped-rule') {
      const globs = globsOf(data.globs ?? data.applyTo)
      if (globs.length === 0 && data.alwaysApply === true) {
        for (const l of lines)
          pool.push({ ...l, score: l.score + 1, order: order++, k: 1 })
        report.entries = 1
        continue
      }
      const text = packRules(lines)
      for (const g of globs) rules.push({ path: g, instructions: text })
      report.entries = text ? globs.length : 0
      continue
    }
    if (cls.kind === 'scoped-doc') {
      const text = packRules(lines)
      if (!text) continue
      nested.push({
        path: cls.scope!,
        instructions: text,
        depth: doc.path.split('/').length,
        src: doc.path,
      })
      report.entries = 1
      continue
    }
    const bonus = POOL_BONUS[cls.kind] ?? 0
    const k =
      cls.kind === 'review-doc' ? 0 : cls.kind === 'contributing' ? 2 : 1
    for (const l of lines)
      pool.push({ ...l, score: l.score + bonus, order: order++, k })
    report.entries = 1
  }
  // Pool order: review docs, then agent docs, then CONTRIBUTING, each in
  // file order — so equal scores keep that precedence.
  const pooled = [...pool].sort((a, b) => a.k - b.k || a.order - b.order)
  const wholeText = packRules(pooled)
  const whole: PathInstruction[] = wholeText
    ? [{ path: '**', instructions: wholeText }]
    : []
  for (const s of sources)
    if (
      (s.kind === 'review-doc' ||
        s.kind === 'agent' ||
        s.kind === 'contributing') &&
      !wholeText
    )
      s.entries = 0
  nested.sort((a, b) => a.depth - b.depth || (a.src < b.src ? -1 : 1))
  const all = [
    ...config,
    ...whole,
    ...rules,
    ...nested.map(({ path, instructions }) => ({ path, instructions })),
  ].filter(e => e.instructions.trim().length > 0)
  const instructions = normalizePathInstructions(all)
  return { instructions, sources, dropped: all.length - instructions.length }
}
