/**
 * LUM-427: actionable-density audit for the agent's resident / on-demand
 * context files (read-only, measure-first — the report is the deliverable,
 * lum392/lum404 mode).
 *
 * SkillReducer (arXiv 2603.29919, two-source verified) measured across 55k
 * skills that **>60% of skill body content is non-actionable** free prose, and
 * that a taxonomy-driven classify + progressive-disclosure pass compresses body
 * 39% / routing description 48% with functional quality +2.8% (cross-model
 * retention 0.965). Anthropic's "Effective context engineering" frames the same
 * goal: keep "the smallest possible set of high-signal tokens".
 *
 * Lumo already enforces budget DISCIPLINE manually — the SKILL.md description
 * ≤1000-char gate (LUM-415) and the CLAUDE.md ~9500-char soft budget (LUM-406),
 * plus references/ loaded on demand. What it never had is a QUANTIFIED measure
 * of how much of each context file is actionable vs free prose. This script is
 * that measure: per target file it reports token count + a structural breakdown
 * (command-spec / flags-table / code-example / when-to-suggest trigger vs free
 * prose) and FLAGS files that blow the per-file token budget or the prose-ratio
 * threshold, so a human knows where to trim.
 *
 * Explicitly NOT in scope (deferred → F queue): delta-debugging auto-compression
 * or LLM rewrite of context files. ETH (arXiv 2602.11988) falsified
 * "delete-the-docs-and-let-the-model-regenerate" (≈+2.7% cost), and CLAUDE.md's
 * own maintenance note bans LLM auto-generation of itself. v1 only exposes; the
 * trimming stays human.
 *
 * Caliber reuse (no new dependency, no duplicate gate):
 *   - token counting   → estimateTokens (lib/context/budget.ts, char/4 proxy)
 *   - description cap   → readSkillDescription (the LUM-415 reader); the audit
 *     SURFACES the description's char length informationally and defers the
 *     actual ≤1000 assertion to the existing `description cap` test.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { estimateTokens } from '../../../lib/context/budget'
import { readSkillDescription } from '../../cli-grammar/doc-examples'

/** Repo root, derived from this file's location (scripts/analysis/context-budget). */
export const REPO_ROOT = join(__dirname, '..', '..', '..')
const SKILL_ROOT = join(REPO_ROOT, 'cli', 'skill')

/**
 * Structural categories. The first four are ACTIONABLE (high-signal: a command
 * the agent can run, a flag/output contract, a runnable example, or a routing
 * trigger). `freeProse` is the non-actionable remainder SkillReducer targets.
 * `heading`/`structural` are pure navigation scaffold — counted toward the file
 * token total but EXCLUDED from the prose ratio (they appear in lean and bloated
 * files alike, so including them would dilute the signal).
 */
export type Category =
  | 'commandSpec'
  | 'flagsTable'
  | 'codeExample'
  | 'whenToSuggest'
  | 'freeProse'
  | 'heading'
  | 'structural'

export const ACTIONABLE_CATEGORIES: Category[] = [
  'commandSpec',
  'flagsTable',
  'codeExample',
  'whenToSuggest',
]

export type Breakdown = Record<Category, number>

function emptyBreakdown(): Breakdown {
  return {
    commandSpec: 0,
    flagsTable: 0,
    codeExample: 0,
    whenToSuggest: 0,
    freeProse: 0,
    heading: 0,
    structural: 0,
  }
}

const WHEN_TO_SUGGEST_HEADING =
  /when to (suggest|use)|triggers?\b|activat|key triggers/i
const COMMAND_BULLET = /^(?:[-*+]|\d+\.)\s+`/
const HEADING_TEXT = /^#+\s*(.*)$/

/**
 * Classify every non-blank line of a markdown file into a structural category
 * and sum estimated tokens per category. Pure: deterministic on content alone.
 *
 * Line-based block tokenizer with three pieces of state — frontmatter, fenced
 * code, and the current heading (so a section can scope its body to
 * `whenToSuggest`). Blank lines are dropped entirely (zero signal, and counting
 * char/4 on whitespace would add noise).
 */
export function classify(content: string): {
  breakdown: Breakdown
  tokens: number
} {
  const breakdown = emptyBreakdown()
  const add = (cat: Category, text: string) => {
    breakdown[cat] += estimateTokens(text)
  }

  const lines = content.split('\n')
  let i = 0

  // --- frontmatter (only when the very first line is a `---` fence) ---
  if (lines[0]?.trim() === '---') {
    i = 1
    while (i < lines.length && lines[i]!.trim() !== '---') {
      const line = lines[i]!
      // The routing description is the single most actionable token block in a
      // skill (SkillReducer's "routing description"); everything else in the
      // frontmatter (name, etc.) is structural metadata.
      if (/^description:/.test(line.trim())) add('whenToSuggest', line)
      else if (line.trim() !== '') add('structural', line)
      i++
    }
    if (i < lines.length) i++ // consume closing `---`
  }

  let inFence = false
  let currentHeading = ''
  for (; i < lines.length; i++) {
    const line = lines[i]!
    const trimmed = line.trim()

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      add('codeExample', line) // fence delimiter counts as example scaffold
      inFence = !inFence
      continue
    }
    if (inFence) {
      add('codeExample', line)
      continue
    }
    if (trimmed === '') continue

    if (trimmed.startsWith('#')) {
      add('heading', line)
      currentHeading = trimmed.replace(HEADING_TEXT, '$1')
      continue
    }
    if (trimmed.startsWith('|')) {
      add('flagsTable', line)
      continue
    }
    if (WHEN_TO_SUGGEST_HEADING.test(currentHeading)) {
      add('whenToSuggest', line)
      continue
    }
    // A list item that LEADS with an inline code span is a command/flag
    // definition (`- \`lumo task create …\` — create a task`). A prose bullet
    // that merely name-drops a command mid-sentence stays free prose — this is
    // the discriminator that stops chatty guidance from inflating actionability.
    if (COMMAND_BULLET.test(trimmed)) {
      add('commandSpec', line)
      continue
    }
    add('freeProse', line)
  }

  const tokens = (Object.values(breakdown) as number[]).reduce(
    (a, b) => a + b,
    0
  )
  return { breakdown, tokens }
}

export type FlagCode = 'OVER_TOKEN_BUDGET' | 'OVER_PROSE_RATIO'

export interface FileAudit {
  /** Repo-relative POSIX path. */
  path: string
  tokens: number
  breakdown: Breakdown
  actionableTokens: number
  /** freeProse / (freeProse + actionable). 0 when the denominator is 0. */
  proseRatio: number
  /** SKILL.md only: the LUM-415 routing-description length (informational). */
  descriptionChars?: number
  flags: FlagCode[]
}

export interface AuditConfig {
  /**
   * Per-file token budget. Calibrated from the real corpus (measure-first): the
   * densest file today is references/docs.md at ~5500 tokens; 9000 leaves
   * headroom for normal growth while catching a file that has bloated past the
   * richest current domain. A tripwire for future drift, expressed in tokens —
   * the token-side mirror of the CLAUDE.md ~9500-CHAR soft budget (LUM-406).
   */
  perFileTokenBudget: number
  /**
   * Max non-actionable prose ratio before a file is flagged. NOT arbitrary: the
   * real corpus is bimodal — structured files (the SKILL.md catalog, flag-table
   * references like docs/tasks/milestones) cluster ≤52% prose, while narrative
   * references (task-context/verify/sessions/…) cluster ≥85%, with the widest
   * empirical gap at 66%→85%. 0.75 sits in that gap, flagging the
   * majority-narrative cluster (where SkillReducer-style trimming has the most
   * surface — the paper measured >60% of skill body non-actionable in the wild)
   * without tripping balanced, structure-dense files.
   */
  maxProseRatio: number
}

export const DEFAULT_CONFIG: AuditConfig = {
  perFileTokenBudget: 9000,
  maxProseRatio: 0.75,
}

/**
 * Audit a single file's content against the config. Pure — no IO. The optional
 * `descriptionChars` is threaded in by the caller for SKILL.md.
 */
export function auditContent(
  path: string,
  content: string,
  config: AuditConfig = DEFAULT_CONFIG,
  descriptionChars?: number
): FileAudit {
  const { breakdown, tokens } = classify(content)
  const actionableTokens = ACTIONABLE_CATEGORIES.reduce(
    (sum, cat) => sum + breakdown[cat],
    0
  )
  const proseDenom = actionableTokens + breakdown.freeProse
  const proseRatio = proseDenom === 0 ? 0 : breakdown.freeProse / proseDenom

  const flags: FlagCode[] = []
  if (tokens > config.perFileTokenBudget) flags.push('OVER_TOKEN_BUDGET')
  if (proseRatio > config.maxProseRatio) flags.push('OVER_PROSE_RATIO')

  return {
    path,
    tokens,
    breakdown,
    actionableTokens,
    proseRatio,
    ...(descriptionChars !== undefined ? { descriptionChars } : {}),
    flags,
  }
}

/**
 * Discover every resident / on-demand context file the agent loads:
 * SKILL.md, every references/*.md, and CLAUDE.md. Sorted, repo-relative POSIX
 * paths. This is the single source of the audit's coverage set — the coverage
 * test re-derives it independently and asserts no file is missed.
 */
export function discoverContextFiles(repoRoot: string = REPO_ROOT): string[] {
  const skillRoot = join(repoRoot, 'cli', 'skill')
  const refDir = join(skillRoot, 'references')
  const refs = readdirSync(refDir)
    .filter(f => f.endsWith('.md'))
    .map(f => join(refDir, f))
  const abs = [
    join(skillRoot, 'SKILL.md'),
    ...refs,
    join(repoRoot, 'CLAUDE.md'),
  ]
  return abs.map(p => relative(repoRoot, p).split('\\').join('/')).sort()
}

/**
 * Read-only: audit every discovered context file. Performs reads only — never
 * writes (criterion 3 invariant).
 */
export function auditAll(
  repoRoot: string = REPO_ROOT,
  config: AuditConfig = DEFAULT_CONFIG
): FileAudit[] {
  const skillRelative = relative(repoRoot, join(SKILL_ROOT, 'SKILL.md'))
    .split('\\')
    .join('/')
  const descriptionChars = readSkillDescription(SKILL_ROOT).length

  return discoverContextFiles(repoRoot).map(rel => {
    const content = readFileSync(join(repoRoot, rel), 'utf8')
    return auditContent(
      rel,
      content,
      config,
      rel === skillRelative ? descriptionChars : undefined
    )
  })
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`
}

/** Render a human-readable, trim-guiding report. Flagged files sort first. */
export function formatReport(
  audits: FileAudit[],
  config: AuditConfig = DEFAULT_CONFIG
): string {
  const sorted = [...audits].sort((a, b) => {
    if (a.flags.length !== b.flags.length)
      return b.flags.length - a.flags.length
    return b.proseRatio - a.proseRatio
  })

  const lines: string[] = []
  lines.push('# Context actionable-density audit (LUM-427)')
  lines.push('')
  lines.push(
    `Budgets: per-file ≤ ${config.perFileTokenBudget} tokens, ` +
      `prose ratio ≤ ${pct(config.maxProseRatio)} ` +
      `(prose = non-actionable free prose ÷ (prose + actionable)).`
  )
  lines.push(
    'Actionable = command-spec + flags-table + code-example + when-to-suggest.'
  )
  lines.push('')
  lines.push('| file | tokens | prose% | cmd | flag | code | trig | flags |')
  lines.push('| ---- | -----: | -----: | --: | ---: | ---: | ---: | ----- |')
  for (const a of sorted) {
    lines.push(
      `| ${a.path} | ${a.tokens} | ${pct(a.proseRatio)} | ` +
        `${a.breakdown.commandSpec} | ${a.breakdown.flagsTable} | ` +
        `${a.breakdown.codeExample} | ${a.breakdown.whenToSuggest} | ` +
        `${a.flags.join(', ') || '—'} |`
    )
  }
  lines.push('')
  const flagged = sorted.filter(a => a.flags.length > 0)
  lines.push(
    flagged.length === 0
      ? '✅ No file over budget.'
      : `⚠️  ${flagged.length} file(s) over budget: ${flagged
          .map(a => a.path)
          .join(', ')}`
  )
  const skill = audits.find(a => a.descriptionChars !== undefined)
  if (skill) {
    lines.push('')
    lines.push(
      `SKILL.md routing description: ${skill.descriptionChars}/1000 chars ` +
        `(LUM-415 cap; enforced by the existing \`description cap\` test).`
    )
  }
  return lines.join('\n')
}

if (require.main === module) {
  // Read-only report generation. No argument writes anything to disk.
  process.stdout.write(formatReport(auditAll()) + '\n')
}
