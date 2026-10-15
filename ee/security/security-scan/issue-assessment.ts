/**
 * LUM-1149 — the linked task / issue assessment: the built-in pre-merge
 * check that holds a pull request to the requirements it was opened for —
 * the Goal and "Done when" items of the Lumo task it is linked to, and the
 * same-repository GitHub issues its description closes or links — and
 * judges each one Addressed / Not addressed / Unclear.
 *
 * PURE: which requirements a task description and a PR description yield,
 * the check's verdict from the per-requirement outcomes, and the two places
 * it is shown on GitHub (the summary block, and one review comment listing
 * the unmet requirements). The gathering (database, GitHub) lives in
 * `ee/security/services/linked-requirements.service.ts`; the run in
 * `pre-merge-checks.service.ts`.
 *
 *   · Any requirement Not addressed ⇒ the check fails (in its mode).
 *   · Otherwise any Unclear ⇒ inconclusive (reported, never blocks).
 *   · No linked task and no linked issue ⇒ not applicable — never a failure.
 *
 * Privacy: a Lumo task is private to its workspace. Its text is quoted on a
 * pull request only when the repository is private (or the workspace owner
 * turned `taskDetailsOnPublicRepos` on); otherwise GitHub shows only which
 * item (e.g. "LUM-12 · Done when 2") and its outcome — never the text nor
 * the model's explanation of it. Issue text comes from the same repository,
 * so it is shown wherever the issue itself is visible.
 *
 * Never changes the task: the assessment only reads it.
 */
import { sanitizeField } from '@/shared/src/sanitize'
import { redactKnownSecrets } from '@/lib/security-scan/scan-secrets'
import { neutralizeSummaryText } from './pr-summary'

export const ISSUE_ASSESSMENT_CHECK_ID = 'issue_assessment'
export const ISSUE_ASSESSMENT_CHECK_NAME = 'Issue assessment'

/** Requirements read from one task (Goal + Done when items), at most. */
export const TASK_REQUIREMENTS_MAX = 12
/** Same-repository issues read from one PR description, at most. */
export const LINKED_ISSUES_MAX = 3
/** One requirement's text as the model reads it, at most. */
export const REQUIREMENT_TEXT_MAX = 600
/** One requirement's text as GitHub shows it, at most. */
export const REQUIREMENT_SHOWN_MAX = 300

export type RequirementSource = 'task' | 'issue'

/** One requirement as gathered (before the model judged it). */
export interface LinkedRequirement {
  /** Stable key: `task:goal`, `task:done:2`, `task:description`, `issue:45`. */
  id: string
  source: RequirementSource
  /** Which item, e.g. "LUM-12 · Done when 2" or "#45" — always safe to show. */
  label: string
  /** The requirement itself (untrusted; fenced for the model). */
  text: string
  /** May the text (and the explanation of it) be shown on the PR? */
  quotable: boolean
}

export const REQUIREMENT_OUTCOMES = [
  'addressed',
  'not_addressed',
  'unclear',
] as const
export type RequirementOutcome = (typeof REQUIREMENT_OUTCOMES)[number]

/** One requirement as judged (stored on the check's result). */
export interface RequirementAssessment {
  id: string
  source: RequirementSource
  label: string
  /** Neutralised and capped; null when it must not be shown on the PR. */
  text: string | null
  quotable: boolean
  outcome: RequirementOutcome
  /** Model-written, neutralised. Shown on the PR only when `quotable`. */
  explanation: string
}

// ── extraction ──────────────────────────────────────────────────────────────

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function capText(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const ITEM_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/
/**
 * A drafting hint left in from the brief template: one italic line (the
 * markdown converter may escape its underscores).
 */
const HINT_RE = /^\s*\\?_[^_].*\\?_\s*$/

function sectionKey(heading: string): 'goal' | 'done' | null {
  const h = heading
    .replace(/[*_`:]/g, '')
    .trim()
    .toLowerCase()
  if (h === 'goal' || h === 'goals') return 'goal'
  if (h === 'done when' || h === 'acceptance criteria') return 'done'
  return null
}

/** PURE — the markdown split into its `goal` / `done` sections (lines). */
function sections(markdown: string): {
  goal: string[] | null
  done: string[] | null
} {
  const out: { goal: string[] | null; done: string[] | null } = {
    goal: null,
    done: null,
  }
  let current: 'goal' | 'done' | null = null
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const h = inFence ? null : HEADING_RE.exec(line)
    if (h) {
      const key = sectionKey(h[2] ?? '')
      current = key && out[key] === null ? key : null
      if (current) out[current] = []
      continue
    }
    if (current) out[current]!.push(line)
  }
  return out
}

/** PURE — a section's list items (continuation lines folded in). */
function listItems(lines: readonly string[]): string[] {
  const items: string[] = []
  let indent = -1
  for (const line of lines) {
    if (HINT_RE.test(line)) continue
    const m = ITEM_RE.exec(line)
    if (m && (indent < 0 || (m[1] ?? '').length <= indent)) {
      indent = (m[1] ?? '').length
      items.push(m[2] ?? '')
      continue
    }
    if (items.length > 0 && line.trim().length > 0)
      items[items.length - 1] += ` ${line.trim()}`
  }
  return items.map(collapse).filter(t => t.length > 0)
}

function prose(lines: readonly string[]): string {
  return collapse(lines.filter(l => !HINT_RE.test(l)).join(' '))
}

/**
 * PURE — a task's requirements from its description (markdown): its Goal
 * as one, each "Done when" item as one. A description with neither section
 * is one requirement (the task's title and description). Empty ⇒ none.
 */
export function extractTaskRequirements(input: {
  identifier: string
  title: string
  markdown: string | null
  quotable: boolean
}): LinkedRequirement[] {
  const md = (input.markdown ?? '').replace(/<!--[\s\S]*?-->/g, '')
  const { goal, done } = sections(md)
  const out: LinkedRequirement[] = []
  const add = (id: string, label: string, text: string) => {
    if (text.length === 0 || out.length >= TASK_REQUIREMENTS_MAX) return
    out.push({
      id,
      source: 'task',
      label: `${input.identifier} · ${label}`,
      text: capText(text, REQUIREMENT_TEXT_MAX),
      quotable: input.quotable,
    })
  }
  if (goal) add('task:goal', 'Goal', prose(goal))
  if (done) {
    const items = listItems(done)
    if (items.length > 0)
      items.forEach((t, i) =>
        add(`task:done:${i + 1}`, `Done when ${i + 1}`, t)
      )
    else add('task:done:1', 'Done when', prose(done))
  }
  if (out.length === 0 && goal === null && done === null) {
    const body = collapse(md)
    if (body.length > 0)
      add(
        'task:description',
        'Description',
        collapse(`${input.title}: ${body}`)
      )
  }
  return out
}

const CLOSING_RE =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+((?:[\w.-]+\/[\w.-]+)?#\d+)/gi
const ISSUE_URL_RE =
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)\b/gi

/**
 * PURE — the issues of `repo` a PR description links: a closing keyword
 * (`closes #12`, `fixes owner/repo#12`) or an issue URL. Other repositories'
 * issues are skipped (Lumo reads only the PR's own repository). Code spans
 * and fences are ignored. In order, deduplicated, at most
 * `LINKED_ISSUES_MAX`.
 */
export function linkedIssueNumbers(body: string, repo: string): number[] {
  const self = repo.toLowerCase()
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
  const found: Array<{ at: number; n: number }> = []
  for (const m of text.matchAll(CLOSING_RE)) {
    const ref = m[1] ?? ''
    const [owner, num] = ref.split('#')
    if (owner && owner.toLowerCase() !== self) continue
    found.push({ at: m.index ?? 0, n: Number(num) })
  }
  for (const m of text.matchAll(ISSUE_URL_RE)) {
    if (`${m[1]}/${m[2]}`.toLowerCase() !== self) continue
    found.push({ at: m.index ?? 0, n: Number(m[3]) })
  }
  const out: number[] = []
  for (const { n } of found.sort((a, b) => a.at - b.at)) {
    if (!Number.isSafeInteger(n) || n <= 0 || out.includes(n)) continue
    out.push(n)
    if (out.length >= LINKED_ISSUES_MAX) break
  }
  return out
}

/** PURE — one GitHub issue as one requirement (its title and body). */
export function issueRequirement(issue: {
  number: number
  title: string
  body: string
}): LinkedRequirement | null {
  const body = collapse(issue.body.replace(/<!--[\s\S]*?-->/g, ' '))
  const text = collapse(body ? `${issue.title}: ${body}` : issue.title)
  if (text.length === 0) return null
  return {
    id: `issue:${issue.number}`,
    source: 'issue',
    label: `#${issue.number}`,
    text: capText(text, REQUIREMENT_TEXT_MAX),
    quotable: true,
  }
}

/** PURE — the requirements as the model reads them (one per line, by id). */
export function requirementsMaterial(
  requirements: readonly LinkedRequirement[]
): string {
  return requirements
    .map(r => `- [${r.id}] (${r.label}) ${collapse(r.text)}`)
    .join('\n')
}

// ── judging ─────────────────────────────────────────────────────────────────

function cleanShown(raw: string, max: number): string {
  return neutralizeSummaryText(redactKnownSecrets(raw), max)
}

/**
 * PURE — the model's per-requirement answers onto the gathered
 * requirements: a requirement it skipped, or answered with an unknown
 * outcome, is Unclear (never Addressed). Text is neutralised here.
 */
export function assessRequirements(
  requirements: readonly LinkedRequirement[],
  answers: ReadonlyArray<{
    id: string
    outcome: string
    explanation?: string
  }>
): RequirementAssessment[] {
  const byId = new Map(answers.map(a => [a.id, a]))
  return requirements.map(r => {
    const a = byId.get(r.id)
    const outcome = (REQUIREMENT_OUTCOMES as readonly string[]).includes(
      a?.outcome ?? ''
    )
      ? (a!.outcome as RequirementOutcome)
      : 'unclear'
    return {
      id: r.id,
      source: r.source,
      label: cleanShown(r.label, 60),
      text: r.quotable ? cleanShown(r.text, REQUIREMENT_SHOWN_MAX) : null,
      quotable: r.quotable,
      outcome,
      explanation: a
        ? cleanShown(a.explanation ?? '', REQUIREMENT_SHOWN_MAX)
        : 'Lumo did not get an answer for this requirement.',
    }
  })
}

/** PURE — the requirements unanswered (the model call failed). */
export function unclearRequirements(
  requirements: readonly LinkedRequirement[],
  why: string
): RequirementAssessment[] {
  return assessRequirements(requirements, []).map(r => ({
    ...r,
    explanation: why,
  }))
}

/** PURE — the check's verdict: any Not addressed fails; any Unclear is inconclusive. */
export function assessmentVerdict(
  assessments: readonly RequirementAssessment[]
): 'passed' | 'failed' | 'inconclusive' {
  if (assessments.some(a => a.outcome === 'not_addressed')) return 'failed'
  if (
    assessments.length === 0 ||
    assessments.some(a => a.outcome === 'unclear')
  )
    return 'inconclusive'
  return 'passed'
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** PURE — the check row's explanation and resolution (Lumo-written). */
export function assessmentSummary(
  assessments: readonly RequirementAssessment[]
): { explanation: string; resolution: string | null } {
  const by = (o: RequirementOutcome) =>
    assessments.filter(a => a.outcome === o).length
  const parts = [
    by('addressed') > 0 ? `${by('addressed')} addressed` : null,
    by('not_addressed') > 0 ? `${by('not_addressed')} not addressed` : null,
    by('unclear') > 0 ? `${by('unclear')} unclear` : null,
  ].filter(Boolean)
  const explanation = `${count(assessments.length, 'linked requirement')}: ${parts.join(', ')}.`
  if (by('not_addressed') > 0)
    return {
      explanation,
      resolution:
        'Implement the requirements marked Not addressed, or update the linked task or issue if they are out of scope.',
    }
  if (by('unclear') > 0)
    return {
      explanation,
      resolution:
        'Check the requirements marked Unclear; the diff alone did not show whether they are met.',
    }
  return { explanation, resolution: null }
}

/** PURE — the stored assessments back; malformed entries are dropped. */
export function parseRequirementAssessments(
  raw: unknown
): RequirementAssessment[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: RequirementAssessment[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const v = r as Record<string, unknown>
    if (typeof v.id !== 'string' || typeof v.label !== 'string') continue
    if (!(REQUIREMENT_OUTCOMES as readonly unknown[]).includes(v.outcome))
      continue
    const quotable = v.quotable === true
    out.push({
      id: v.id,
      source: v.source === 'issue' ? 'issue' : 'task',
      label: cleanShown(v.label, 60),
      text:
        quotable && typeof v.text === 'string'
          ? cleanShown(v.text, REQUIREMENT_SHOWN_MAX)
          : null,
      quotable,
      outcome: v.outcome as RequirementOutcome,
      explanation:
        typeof v.explanation === 'string'
          ? cleanShown(v.explanation, REQUIREMENT_SHOWN_MAX)
          : '',
    })
  }
  return out
}

// ── on GitHub ───────────────────────────────────────────────────────────────

const OUTCOME_LABEL: Record<RequirementOutcome, string> = {
  addressed: '✅ Addressed',
  not_addressed: '❌ Not addressed',
  unclear: '❓ Unclear',
}

function inline(text: string): string {
  return sanitizeField(text)
    .replace(/[`\r\n]/g, ' ')
    .trim()
}

/** PURE — one requirement as a list line (text and explanation only when quotable). */
export function requirementLine(a: RequirementAssessment): string {
  const head = `${OUTCOME_LABEL[a.outcome]} — **${inline(a.label)}**`
  if (!a.quotable) return `- ${head} (details in Lumo)`
  const text = a.text ? `: ${inline(a.text)}` : ''
  const why = a.explanation ? ` — _${inline(a.explanation)}_` : ''
  return `- ${head}${text}${why}`
}

export const WITHHELD_NOTE =
  'Requirements from the linked Lumo task are not quoted on a public repository: open the task in Lumo for the details (a workspace owner can allow them with `lumo workspace security-scan --repo <owner/name> --task-details-on-public-repos on`).'

/**
 * PURE — the per-requirement block of the PR summary, under the checks
 * table: unmet requirements open, an all-addressed list folded. Null when
 * there is nothing to list.
 */
export function formatRequirementsBlock(
  assessments: readonly RequirementAssessment[] | undefined
): string | null {
  if (!assessments || assessments.length === 0) return null
  const lines = assessments.map(requirementLine)
  const withheld = assessments.some(a => !a.quotable)
  const body = [lines.join('\n'), ...(withheld ? [WITHHELD_NOTE] : [])].join(
    '\n\n'
  )
  const open = assessments.some(a => a.outcome !== 'addressed')
  return open
    ? `**Linked requirements:**\n\n${body}`
    : `<details>\n<summary>Linked requirements (${assessments.length})</summary>\n\n${body}\n\n</details>`
}

/** FNV-1a, hex — a short stable key, not a security boundary. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

const MARKER_PREFIX = '<!-- lumo-issue-assessment:'

/**
 * PURE — the key of a set of unmet requirements: the review comment is
 * posted once per distinct set (a push that leaves the same items unmet
 * posts nothing new). Null when nothing is unmet.
 */
export function unmetKey(
  assessments: readonly RequirementAssessment[] | undefined
): string | null {
  const unmet = (assessments ?? [])
    .filter(a => a.outcome === 'not_addressed')
    .map(a => `${a.label}|${a.id}`)
    .sort()
  return unmet.length > 0 ? fnv1a(unmet.join('\n')) : null
}

export function unmetMarker(key: string): string {
  return `${MARKER_PREFIX}${key} -->`
}

/** PURE — has a review body with this key's marker already been posted? */
export function hasUnmetMarker(
  bodies: ReadonlyArray<string | null | undefined>,
  key: string
): boolean {
  const marker = unmetMarker(key)
  return bodies.some(b => typeof b === 'string' && b.includes(marker))
}

/**
 * PURE — the review comment flagging the unmet requirements. Null when
 * nothing is unmet.
 */
export function buildUnmetRequirementsReview(input: {
  assessments: readonly RequirementAssessment[] | undefined
  headSha: string
  mode: 'warning' | 'error'
}): string | null {
  const key = unmetKey(input.assessments)
  if (!key) return null
  const unmet = (input.assessments ?? []).filter(
    a => a.outcome === 'not_addressed'
  )
  const withheld = unmet.some(a => !a.quotable)
  const blocks = [
    `**Lumo — ${count(unmet.length, 'linked requirement')} not addressed** · \`${input.headSha.slice(0, 7)}\``,
    unmet.map(requirementLine).join('\n'),
    `The diff does not appear to implement ${unmet.length === 1 ? 'this requirement' : 'these requirements'} from the Lumo task linked to this pull request or the issues it references. Implement ${unmet.length === 1 ? 'it' : 'them'}, or update the task or issue if ${unmet.length === 1 ? 'it is' : 'they are'} out of scope. Reported by the **${ISSUE_ASSESSMENT_CHECK_NAME}** pre-merge check (\`${input.mode}\`); findings that block DONE are not affected.`,
    ...(withheld ? [WITHHELD_NOTE] : []),
    unmetMarker(key),
  ]
  return blocks.join('\n\n')
}
