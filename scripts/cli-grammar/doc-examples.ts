/**
 * LUM-415: mine `lumo …` invocation examples out of the skill docs
 * (cli/skill/SKILL.md + references/*.md) so they can be judged by
 * the LUM-413 AST validator. Documentation examples are the agent's few-shot
 * set — an example that doesn't parse against the live grammar IS
 * documentation/behavior drift (the exact failure mode behind the LUM-392
 * flag hallucinations).
 *
 * Pure parsing helpers; the only I/O is the directory walk in
 * collectDocExamples / readSkillDescription.
 */
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { CliGrammar } from './grammar'

export interface DocExampleLine {
  /** Path relative to the skill root, e.g. "references/tasks.md". */
  file: string
  /** 1-based line number in the markdown source. */
  line: number
  /** The raw example line as written in the doc. */
  raw: string
  /** The line after placeholder normalization (what gets validated). */
  normalized: string
}

/**
 * Replace `<placeholder>` tokens with a neutral word so the shell tokenizer
 * does not read them as redirections (`<docId>` → `PH`). Heredoc markers
 * (`<<'EOF'`) carry no closing `>` and survive untouched — validateSegment
 * declines to judge those segments anyway.
 */
export function normalizePlaceholders(line: string): string {
  return line.replace(/<[^<>\s][^<>]*>/g, 'PH')
}

/**
 * Strip an inline trailing comment (` # …`) that sits outside quotes.
 * Doc examples annotate variants this way (`lumo task list -n 5  # cap`).
 */
export function stripInlineComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (c === "'" && !inDouble) inSingle = !inSingle
    else if (c === '"' && !inSingle) inDouble = !inDouble
    else if (
      c === '#' &&
      !inSingle &&
      !inDouble &&
      i > 0 &&
      /\s/.test(line[i - 1]!)
    ) {
      return line.slice(0, i).trimEnd()
    }
  }
  return line
}

/**
 * Extract example lines from fenced code blocks. Only lines whose trimmed
 * form starts with `lumo ` (optionally prefixed `$ `) are examples — output
 * transcripts inside the same fences (e.g. `Next: lumo session attach …`)
 * never start with the binary name and are skipped.
 */
export function extractExampleLines(
  markdown: string
): Array<{ line: number; raw: string }> {
  const out: Array<{ line: number; raw: string }> = []
  let inFence = false
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i]!.trim()
    if (trimmed.startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (!inFence) continue
    const candidate = trimmed.startsWith('$ ') ? trimmed.slice(2) : trimmed
    if (candidate === 'lumo' || candidate.startsWith('lumo ')) {
      out.push({ line: i + 1, raw: candidate })
    }
  }
  return out
}

/** SKILL.md plus every references/*.md, relative to the skill root. */
export function skillDocFiles(skillRoot: string): string[] {
  const refs = readdirSync(join(skillRoot, 'references'))
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => `references/${f}`)
  return ['SKILL.md', ...refs]
}

export function collectDocExamples(skillRoot: string): DocExampleLine[] {
  const out: DocExampleLine[] = []
  for (const file of skillDocFiles(skillRoot)) {
    const markdown = readFileSync(join(skillRoot, file), 'utf8')
    for (const { line, raw } of extractExampleLines(markdown)) {
      out.push({
        file,
        line,
        raw,
        normalized: normalizePlaceholders(stripInlineComment(raw)),
      })
    }
  }
  return out
}

/**
 * Runnable command paths = every node that can actually be called: grammar
 * leaves, plus any parent that carries its own action (LUM-706; none since
 * LUM-1233 3f made `priority` a plain group). Pure routing nodes (`lumo task`)
 * are excluded: there is no bare invocation of them to document. `hook *` is
 * the documented-internal surface (invoked by settings.json, not by agents or
 * humans) and is exempt from doc coverage.
 */
export const COVERAGE_ALLOWLIST_PREFIXES = ['hook']

export function runnableGrammarPaths(grammar: CliGrammar): string[] {
  return Object.entries(grammar.commands)
    .filter(([, node]) => !node.hasSubcommands || node.isInvokable)
    .map(([path]) => path)
    .filter(
      path =>
        !COVERAGE_ALLOWLIST_PREFIXES.some(
          p => path === p || path.startsWith(`${p} `)
        )
    )
    .sort()
}

/** The frontmatter `description:` value of SKILL.md (the resident trigger prompt). */
export function readSkillDescription(skillRoot: string): string {
  const md = readFileSync(join(skillRoot, 'SKILL.md'), 'utf8')
  const fm = md.match(/^---\n([\s\S]*?)\n---/)
  if (!fm) throw new Error('SKILL.md has no frontmatter block')
  const desc = fm[1]!.match(/^description:\s*(.*)$/m)
  if (!desc) throw new Error('SKILL.md frontmatter has no description key')
  return desc[1]!.trim()
}
