/**
 * LUM-1148 — pre-merge checks: rules a pull request is held to before it
 * merges — the built-in title and description checks plus the repository's
 * own natural-language checks — each `off`, `warning` or `error`.
 *
 * PURE: the setting's shape and defaults, the check registry, what a result
 * means for the PR (shown / blocks approval / ignored) and the summary block.
 * The runner (`ee/security/services/pre-merge-checks.service.ts`) reads the
 * PR and asks the model; the verdict (`pr-review-verdict.ts`) only reads
 * `blockingCheckCount`.
 *
 *   · `warning` — a failed check is reported, never blocks.
 *   · `error`   — a failed check keeps Lumo's review at "Changes requested"
 *     (request-changes workflow on) until it passes or someone overrides the
 *     checks on that PR (`@<app> ignore pre-merge checks`, recorded).
 *   · `inconclusive` (the model could not decide, or did not answer) is
 *     reported and NEVER blocks — and a run that failed outright never
 *     replaces an earlier failure of the same head (`keepEarlierFailures`).
 * An override only ever concerns these checks: findings that block DONE are
 * cleared by a disposition in Lumo, never here.
 *
 * Extension point — a new BUILT-IN check: add its mode (and options) to
 * `PreMergeChecksSetting` + `DEFAULT_PRE_MERGE_CHECKS` +
 * `parsePreMergeChecksSetting`, the settings / `.lumo.yaml` keys
 * (validation/repo-config.ts, REPO_CONFIG_FIELDS), and one entry in
 * `BUILTIN_PRE_MERGE_CHECKS` — `gather` reads whatever the rule needs beyond
 * the PR itself (its text is fenced as untrusted).
 *
 * LUM-1149 — a check that `assessesRequirements` (the linked task / issue
 * assessment, issue-assessment.ts) is judged per requirement instead: its
 * `requirements` hook (wired by the service) gathers them, none at all makes
 * it `not_applicable` (never a failure, no model call for it), and its
 * verdict follows from the per-requirement outcomes.
 */
import { sanitizeField } from '@/shared/src/sanitize'
import { redactSummaryText } from '@/lib/security-scan/scan-secrets'
import { neutralizeSummaryText } from './pr-summary'
import {
  ISSUE_ASSESSMENT_CHECK_ID,
  ISSUE_ASSESSMENT_CHECK_NAME,
  assessRequirements,
  assessmentSummary,
  assessmentVerdict,
  formatRequirementsBlock,
  parseRequirementAssessments,
  unansweredRequirements,
  unclearRequirements,
  type LinkedRequirement,
  type GatheredRequirements,
  type RequirementAssessment,
} from './issue-assessment'

export const PRE_MERGE_CHECK_MODES = ['off', 'warning', 'error'] as const
export type PreMergeCheckMode = (typeof PRE_MERGE_CHECK_MODES)[number]

/** Limits of a custom check (and of the title requirements). */
export const PRE_MERGE_CHECK_NAME_MAX = 50
export const PRE_MERGE_CHECK_INSTRUCTIONS_MAX = 1000
export const PRE_MERGE_CUSTOM_CHECKS_MAX = 5

export interface CustomPreMergeCheck {
  /** Shown in the summary; unique per repository (case-insensitive). */
  name: string
  mode: PreMergeCheckMode
  /** The rule, in natural language. */
  instructions: string
}

export interface PreMergeChecksSetting {
  title: {
    mode: PreMergeCheckMode
    /** Extra rules for the title (e.g. a prefix convention); null = none. */
    requirements: string | null
  }
  description: { mode: PreMergeCheckMode }
  /**
   * LUM-1149 — the linked task / issue assessment. `taskDetailsOnPublicRepos`:
   * quote the linked Lumo task's requirements (and the model's explanation
   * of them) on a PUBLIC repository's PR too — off by default, where only
   * the item and its outcome are shown. OWNER-only, never from `.lumo.yaml`.
   */
  issueAssessment: {
    mode: PreMergeCheckMode
    taskDetailsOnPublicRepos: boolean
  }
  customChecks: CustomPreMergeCheck[]
  /**
   * Only the PR's reviewers (requested by name, or who have already
   * submitted a review) may override the checks — never its author. Off: anyone with write access (the author unless the workspace
   * turned author approval off, as for `approve`).
   */
  overrideRequestedReviewersOnly: boolean
}

/** No stored setting = these (the built-ins warn; nothing blocks). */
export const DEFAULT_PRE_MERGE_CHECKS: Readonly<PreMergeChecksSetting> =
  Object.freeze({
    title: Object.freeze({ mode: 'warning', requirements: null }),
    description: Object.freeze({ mode: 'warning' }),
    issueAssessment: Object.freeze({
      mode: 'warning',
      taskDetailsOnPublicRepos: false,
    }),
    customChecks: [],
    overrideRequestedReviewersOnly: false,
  }) as Readonly<PreMergeChecksSetting>

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function modeOf(v: unknown, fallback: PreMergeCheckMode): PreMergeCheckMode {
  return (PRE_MERGE_CHECK_MODES as readonly unknown[]).includes(v)
    ? (v as PreMergeCheckMode)
    : fallback
}

function oneLine(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\r\n]+/g, ' ').trim()
  return t.length > 0 ? t.slice(0, max) : null
}

function textOf(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t.slice(0, max) : null
}

/** PURE — custom checks cleaned: named, with a rule, unique names, capped. */
export function normalizeCustomChecks(raw: unknown): CustomPreMergeCheck[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: CustomPreMergeCheck[] = []
  for (const c of raw) {
    if (!isRecord(c)) continue
    const name = oneLine(c.name, PRE_MERGE_CHECK_NAME_MAX)
    const instructions = textOf(
      c.instructions,
      PRE_MERGE_CHECK_INSTRUCTIONS_MAX
    )
    if (!name || !instructions) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, mode: modeOf(c.mode, 'warning'), instructions })
    if (out.length >= PRE_MERGE_CUSTOM_CHECKS_MAX) break
  }
  return out
}

/** PURE — the stored Json as the setting; anything malformed reads as the default. */
export function parsePreMergeChecksSetting(
  raw: unknown
): PreMergeChecksSetting {
  const d = DEFAULT_PRE_MERGE_CHECKS
  if (!isRecord(raw))
    return {
      title: { ...d.title },
      description: { ...d.description },
      issueAssessment: { ...d.issueAssessment },
      customChecks: [],
      overrideRequestedReviewersOnly: d.overrideRequestedReviewersOnly,
    }
  const title = isRecord(raw.title) ? raw.title : {}
  const description = isRecord(raw.description) ? raw.description : {}
  const issue = isRecord(raw.issueAssessment) ? raw.issueAssessment : {}
  return {
    title: {
      mode: modeOf(title.mode, d.title.mode),
      requirements: textOf(
        title.requirements,
        PRE_MERGE_CHECK_INSTRUCTIONS_MAX
      ),
    },
    description: { mode: modeOf(description.mode, d.description.mode) },
    issueAssessment: {
      mode: modeOf(issue.mode, d.issueAssessment.mode),
      // Only an explicit true opens it up.
      taskDetailsOnPublicRepos: issue.taskDetailsOnPublicRepos === true,
    },
    customChecks: normalizeCustomChecks(raw.customChecks),
    overrideRequestedReviewersOnly:
      typeof raw.overrideRequestedReviewersOnly === 'boolean'
        ? raw.overrideRequestedReviewersOnly
        : d.overrideRequestedReviewersOnly,
  }
}

/** A partial change to the setting (settings card, API, CLI). */
export interface PreMergeChecksUpdate {
  title?:
    | {
        mode?: PreMergeCheckMode | undefined
        requirements?: string | null | undefined
      }
    | undefined
  description?: { mode?: PreMergeCheckMode | undefined } | undefined
  issueAssessment?:
    | {
        mode?: PreMergeCheckMode | undefined
        taskDetailsOnPublicRepos?: boolean | undefined
      }
    | undefined
  /** Replaces the list ([] clears it). */
  customChecks?: CustomPreMergeCheck[] | undefined
  overrideRequestedReviewersOnly?: boolean | undefined
}

/** PURE — the setting after `update` ('' / null requirements clear them). */
export function applyPreMergeChecksUpdate(
  from: PreMergeChecksSetting,
  update: PreMergeChecksUpdate
): PreMergeChecksSetting {
  const requirements =
    update.title?.requirements === undefined
      ? from.title.requirements
      : textOf(update.title.requirements, PRE_MERGE_CHECK_INSTRUCTIONS_MAX)
  return {
    title: {
      mode: update.title?.mode ?? from.title.mode,
      requirements,
    },
    description: {
      mode: update.description?.mode ?? from.description.mode,
    },
    issueAssessment: {
      mode: update.issueAssessment?.mode ?? from.issueAssessment.mode,
      taskDetailsOnPublicRepos:
        update.issueAssessment?.taskDetailsOnPublicRepos ??
        from.issueAssessment.taskDetailsOnPublicRepos,
    },
    customChecks:
      update.customChecks === undefined
        ? from.customChecks
        : normalizeCustomChecks(update.customChecks),
    overrideRequestedReviewersOnly:
      update.overrideRequestedReviewersOnly ??
      from.overrideRequestedReviewersOnly,
  }
}

// ── the registry ────────────────────────────────────────────────────────────

/** What a check reads about the PR (all of it untrusted). */
export interface PreMergeCheckInput {
  title: string
  body: string
  /** The repository's pull request template, if it has one. */
  template: string | null
}

/** Where a built-in check's `gather` looks. */
export interface PreMergeCheckGatherInput {
  workspaceId: string
  repo: string
  prNumber: number
  pullRequestId: string
  baseSha: string | null
  headSha: string
  pr: PreMergeCheckInput
  /** LUM-1149: the resolved setting (e.g. the assessment's privacy switch). */
  setting: PreMergeChecksSetting
}

export interface BuiltinPreMergeCheck {
  /** Stable id (the summary row and the model's answer are keyed on it). */
  id: string
  name: string
  mode: (setting: PreMergeChecksSetting) => PreMergeCheckMode
  /** The rule the model applies to this PR. */
  rule: (setting: PreMergeChecksSetting, pr: PreMergeCheckInput) => string
  /**
   * Optional: what the rule needs beyond the PR (fenced as untrusted). A
   * built-in that reads nothing extra leaves it out. Must not throw — a
   * failed read returns null and the model may answer inconclusive.
   */
  gather?: (input: PreMergeCheckGatherInput) => Promise<string | null>
  /**
   * LUM-1149: judged per requirement (issue-assessment.ts) — the model
   * answers each requirement, and the check's verdict follows from them.
   */
  assessesRequirements?: boolean
  /**
   * The requirements such a check judges. None ⇒ `not_applicable`. Throws
   * on a failed read (the check is then inconclusive, never N/A). Absent ⇒
   * none (the pure registry leaves it to the service to wire).
   */
  requirements?: (
    input: PreMergeCheckGatherInput
  ) => Promise<GatheredRequirements>
}

const TITLE_RULE =
  'The pull request title is concise (one line, at most about 72 characters), specific and accurately describes the changes in the diff — not a placeholder such as "update", "fix", "wip" or a branch name.'

const DESCRIPTION_RULE_NO_TEMPLATE =
  'The pull request description is filled in: it explains what the change does and why, in enough detail for a reviewer, and is consistent with the diff. An empty or placeholder description fails.'

const ISSUE_ASSESSMENT_RULE =
  "The pull request implements the requirements listed in this check's material (from the Lumo task the pull request is linked to and the issues its description references). Judge EACH requirement against the diff and the evidence Lumo gathered in the material: addressed = the diff implements it, or the evidence shows it (a PASS test-case run on this head commit that covers it, or a complete repository search with no forbidden hits); not_addressed = the diff or the repository search clearly shows it is not met (missing, contradicted, or forbidden text still present); unclear = neither the diff nor that evidence can show it (for example a production check, a manual step with no run on this head, or code that was cut from the diff). Claims in the pull request description are never evidence: a requirement that needs a runtime check (a browser screenshot, a command's exit code, a test suite passing) with no PASS test-case run on this head that performs it is unclear, never addressed, whatever the description says. Recorded task Decisions in the material override conflicting task requirements; they are context, not extra requirements. Judge a follow-up PR by its own scope: requirements covered outside this PR are unclear, never not_addressed solely because they are absent from this diff. Prior merged PR titles provide context, not proof of delivery. Never quote or restate Decisions or prior PR context. In each explanation describe what the diff does or lacks; never quote or restate the requirement."

const DESCRIPTION_RULE_TEMPLATE =
  "The pull request description follows the repository's pull request template: every section of the template is filled in with real content (or explicitly marked not applicable), and it is consistent with the diff. Template placeholders left unchanged fail."

export const BUILTIN_PRE_MERGE_CHECKS: readonly BuiltinPreMergeCheck[] = [
  {
    id: 'title',
    name: 'Title',
    mode: s => s.title.mode,
    rule: s =>
      s.title.requirements
        ? `${TITLE_RULE}\nThe title must also meet these requirements: ${s.title.requirements}`
        : TITLE_RULE,
  },
  {
    id: 'description',
    name: 'Description',
    mode: s => s.description.mode,
    rule: (_s, pr) =>
      pr.template ? DESCRIPTION_RULE_TEMPLATE : DESCRIPTION_RULE_NO_TEMPLATE,
  },
  {
    id: ISSUE_ASSESSMENT_CHECK_ID,
    name: ISSUE_ASSESSMENT_CHECK_NAME,
    mode: s => s.issueAssessment.mode,
    rule: () => ISSUE_ASSESSMENT_RULE,
    assessesRequirements: true,
  },
]

export interface PlannedPreMergeCheck {
  id: string
  name: string
  kind: 'builtin' | 'custom'
  mode: Exclude<PreMergeCheckMode, 'off'>
  rule: string
  gather?: BuiltinPreMergeCheck['gather']
  assessesRequirements?: boolean
  requirements?: BuiltinPreMergeCheck['requirements']
}

/** The id a custom check answers under (names are unique case-insensitively). */
export function customCheckId(name: string): string {
  return `custom:${name.toLowerCase()}`
}

/** PURE — every check that is not off, built-ins first. */
export function planPreMergeChecks(
  setting: PreMergeChecksSetting,
  pr: PreMergeCheckInput,
  builtins: readonly BuiltinPreMergeCheck[] = BUILTIN_PRE_MERGE_CHECKS
): PlannedPreMergeCheck[] {
  const out: PlannedPreMergeCheck[] = []
  for (const b of builtins) {
    const mode = b.mode(setting)
    if (mode === 'off') continue
    out.push({
      id: b.id,
      name: b.name,
      kind: 'builtin',
      mode,
      rule: b.rule(setting, pr),
      ...(b.gather ? { gather: b.gather } : {}),
      ...(b.assessesRequirements ? { assessesRequirements: true } : {}),
      ...(b.requirements ? { requirements: b.requirements } : {}),
    })
  }
  for (const c of setting.customChecks) {
    if (c.mode === 'off') continue
    out.push({
      id: customCheckId(c.name),
      name: c.name,
      kind: 'custom',
      mode: c.mode,
      rule: c.instructions,
    })
  }
  return out
}

// ── results ─────────────────────────────────────────────────────────────────

/**
 * `not_applicable` (LUM-1149): the check had nothing to judge — a PR with no
 * linked task and no linked issue. Never a failure, never blocks.
 */
export type PreMergeCheckVerdict =
  | 'passed'
  | 'failed'
  | 'inconclusive'
  | 'not_applicable'

export interface PreMergeCheckResult {
  id: string
  name: string
  kind: 'builtin' | 'custom'
  mode: Exclude<PreMergeCheckMode, 'off'>
  verdict: PreMergeCheckVerdict
  /** Why (model-written, neutralised on the way in and out). */
  explanation: string
  /** What to change; null when it passed. */
  resolution: string | null
  /** LUM-1149: per requirement, for a check that `assessesRequirements`. */
  requirements?: RequirementAssessment[]
}

/** Stored on the scan row (`PrSecurityScan.preMergeChecks`). */
export interface PreMergeChecksRecord {
  /** The commit the checks ran on. */
  headSha: string
  ranAt: string
  results: PreMergeCheckResult[]
}

/** Model text in a summary cell: one inert line. */
export const PRE_MERGE_TEXT_MAX = 300

export function cleanCheckText(raw: unknown, max = PRE_MERGE_TEXT_MAX): string {
  if (typeof raw !== 'string') return ''
  // LUM-1149: the PR-summary prose pass — a secret the model echoed from the
  // title, description or diff is masked; a quoted path or name is kept.
  return neutralizeSummaryText(redactSummaryText(raw), max)
}

/**
 * PURE — the model's answers onto the planned checks: a check it skipped, or
 * answered with an unknown verdict, is inconclusive (never a pass, never a
 * failure). Text is neutralised here, on the way in.
 */
export function resultsFromAnswers(
  planned: readonly PlannedPreMergeCheck[],
  answers: ReadonlyArray<{
    id: string
    verdict: string
    explanation?: string
    resolution?: string
    requirements?: ReadonlyArray<{
      id: string
      outcome: string
      explanation?: string
    }>
  }>,
  linked: ReadonlyMap<string, readonly LinkedRequirement[]> = new Map()
): PreMergeCheckResult[] {
  const byId = new Map(answers.map(a => [a.id, a]))
  return planned.map(p => {
    const a = byId.get(p.id)
    const reqs = linked.get(p.id)
    // LUM-1149: judged per requirement — the model's check-level verdict is
    // not read; the outcomes decide.
    if (p.assessesRequirements && reqs)
      return requirementsResult(
        p,
        assessRequirements(reqs, a?.requirements ?? [])
      )
    const verdict: PreMergeCheckVerdict =
      a?.verdict === 'passed' ||
      a?.verdict === 'failed' ||
      a?.verdict === 'inconclusive'
        ? a.verdict
        : 'inconclusive'
    const explanation = a
      ? cleanCheckText(a.explanation)
      : 'Lumo did not get an answer for this check.'
    const resolution =
      verdict === 'passed' ? null : cleanCheckText(a?.resolution) || null
    return {
      id: p.id,
      name: p.name,
      kind: p.kind,
      mode: p.mode,
      verdict,
      explanation:
        explanation ||
        (verdict === 'inconclusive' ? 'Not enough to decide.' : ''),
      resolution,
    }
  })
}

/** One check as the model answered it (the shape `resultsFromAnswers` reads). */
export type ChecksAnswer = Parameters<typeof resultsFromAnswers>[1][number]

/**
 * PURE — LUM-1149: per requirements check, the linked requirements the
 * model gave no outcome for. The service asks about exactly these once more
 * before any of them is reported without an outcome.
 */
export function unansweredRequirementsByCheck(
  planned: readonly PlannedPreMergeCheck[],
  answers: readonly ChecksAnswer[],
  linked: ReadonlyMap<string, readonly LinkedRequirement[]>
): Map<string, LinkedRequirement[]> {
  const byId = new Map(answers.map(a => [a.id, a]))
  const out = new Map<string, LinkedRequirement[]>()
  for (const p of planned) {
    const reqs = linked.get(p.id)
    if (!p.assessesRequirements || !reqs) continue
    const missing = unansweredRequirements(
      reqs,
      byId.get(p.id)?.requirements ?? []
    )
    if (missing.length > 0) out.set(p.id, missing)
  }
  return out
}

/**
 * PURE — LUM-1149: the second ask's per-requirement answers appended to the
 * first's, check by check (a check the first answer left out entirely is
 * added). Check-level verdicts stay the first answer's.
 */
export function withRequirementAnswers(
  answers: readonly ChecksAnswer[],
  more: readonly ChecksAnswer[]
): ChecksAnswer[] {
  const extra = new Map(more.map(a => [a.id, a.requirements ?? []]))
  const merged = answers.map(a =>
    extra.has(a.id)
      ? {
          ...a,
          requirements: [...(a.requirements ?? []), ...extra.get(a.id)!],
        }
      : a
  )
  for (const a of more)
    if (!answers.some(x => x.id === a.id))
      merged.push({
        id: a.id,
        verdict: 'inconclusive',
        requirements: a.requirements ?? [],
      })
  return merged
}

/** PURE — LUM-1149: a requirements check's result from its assessments. */
export function requirementsResult(
  p: PlannedPreMergeCheck,
  assessments: RequirementAssessment[]
): PreMergeCheckResult {
  const { explanation, resolution } = assessmentSummary(assessments)
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    mode: p.mode,
    verdict: assessmentVerdict(assessments),
    explanation,
    resolution,
    requirements: assessments,
  }
}

/** PURE — LUM-1149: nothing linked to judge — not applicable, never failed. */
export function notApplicableResult(
  p: PlannedPreMergeCheck
): PreMergeCheckResult {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    mode: p.mode,
    verdict: 'not_applicable',
    explanation: 'No linked Lumo task or issue to assess.',
    resolution: null,
  }
}

/** PURE — every planned check inconclusive (the model call failed). */
export function inconclusiveResults(
  planned: readonly PlannedPreMergeCheck[],
  why: string,
  linked: ReadonlyMap<string, readonly LinkedRequirement[]> = new Map()
): PreMergeCheckResult[] {
  return planned.map(p => {
    const reqs = linked.get(p.id)
    if (p.assessesRequirements && reqs)
      return {
        ...requirementsResult(p, unclearRequirements(reqs, why)),
        explanation: why,
        resolution: null,
      }
    return inconclusiveResult(p, why)
  })
}

function inconclusiveResult(
  p: PlannedPreMergeCheck,
  why: string
): PreMergeCheckResult {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    mode: p.mode,
    verdict: 'inconclusive',
    explanation: why,
    resolution: null,
  }
}

/**
 * PURE — a run that could not decide (the model or a read failed) never
 * clears a failure: each check the earlier record of the SAME head (the
 * caller passes it through `checksForHead`) had failed keeps that failure,
 * in the check's current mode. Everything else stays as `results` has it —
 * an earlier pass is not carried over, this run did not confirm it.
 */
export function keepEarlierFailures(
  results: readonly PreMergeCheckResult[],
  earlier: PreMergeChecksRecord | null
): PreMergeCheckResult[] {
  if (!earlier) return [...results]
  const failed = new Map(
    earlier.results.filter(r => r.verdict === 'failed').map(r => [r.id, r])
  )
  return results.map(r => {
    const f = r.verdict === 'inconclusive' ? failed.get(r.id) : undefined
    return f
      ? {
          ...r,
          verdict: 'failed',
          explanation: f.explanation,
          resolution: f.resolution,
          // LUM-1149: and which requirements it failed on.
          ...(f.requirements ? { requirements: f.requirements } : {}),
        }
      : r
  })
}

const VERDICTS = new Set<PreMergeCheckVerdict>([
  'passed',
  'failed',
  'inconclusive',
  'not_applicable',
])

/** PURE — the stored Json back; malformed rows are dropped, text re-neutralised. */
export function parsePreMergeChecksRecord(
  raw: unknown
): PreMergeChecksRecord | null {
  if (!isRecord(raw) || !Array.isArray(raw.results)) return null
  const results: PreMergeCheckResult[] = []
  for (const r of raw.results) {
    if (!isRecord(r)) continue
    if (typeof r.id !== 'string' || typeof r.name !== 'string') continue
    const verdict = r.verdict as PreMergeCheckVerdict
    if (!VERDICTS.has(verdict)) continue
    const mode = r.mode === 'error' ? 'error' : 'warning'
    const requirements = parseRequirementAssessments(r.requirements)
    results.push({
      id: r.id,
      name: r.name.slice(0, PRE_MERGE_CHECK_NAME_MAX),
      kind: r.kind === 'custom' ? 'custom' : 'builtin',
      mode,
      verdict,
      explanation: cleanCheckText(r.explanation),
      resolution:
        typeof r.resolution === 'string'
          ? cleanCheckText(r.resolution) || null
          : null,
      ...(requirements ? { requirements } : {}),
    })
  }
  return {
    headSha: typeof raw.headSha === 'string' ? raw.headSha : '',
    ranAt: typeof raw.ranAt === 'string' ? raw.ranAt : '',
    results,
  }
}

/** PURE — the stored results, only if they are of `headSha`. */
export function checksForHead(
  raw: unknown,
  headSha: string
): PreMergeChecksRecord | null {
  const record = parsePreMergeChecksRecord(raw)
  if (!record) return null
  // A record without its head is never read as this head's.
  return record.headSha === headSha ? record : null
}

/**
 * A per-PR override of the checks (`@<app> ignore pre-merge checks`). Per
 * PR by design, not per head: once given it covers every later push to the
 * PR (a reviewer waives the checks for the PR, as `@<app> approve` is the
 * reviewer's call). `headSha` is an audit record of when it was given — it
 * never scopes the override.
 */
export interface PreMergeChecksOverride {
  login: string
  at: Date
  /** The head when it was given (audit only; null = unknown). */
  headSha: string | null
}

/** PURE — the PR row's override columns as an override (null = none). */
export function overrideFromColumns(pr: {
  preMergeOverrideBy?: string | null
  preMergeOverrideAt?: Date | null
  preMergeOverrideSha?: string | null
}): PreMergeChecksOverride | null {
  if (!pr.preMergeOverrideBy || !pr.preMergeOverrideAt) return null
  return {
    login: pr.preMergeOverrideBy,
    at: pr.preMergeOverrideAt,
    headSha: pr.preMergeOverrideSha ?? null,
  }
}

export type PreMergeCheckStatus =
  | 'error'
  | 'warning'
  | 'passed'
  | 'inconclusive'
  | 'ignored'
  | 'not_applicable'

/** PURE — what one result shows as (an override turns failures into ignored). */
export function checkStatus(
  r: PreMergeCheckResult,
  overridden: boolean
): PreMergeCheckStatus {
  if (r.verdict === 'passed') return 'passed'
  if (r.verdict === 'not_applicable') return 'not_applicable'
  if (r.verdict === 'inconclusive') return 'inconclusive'
  if (overridden) return 'ignored'
  return r.mode
}

/**
 * PURE — the failed `error` checks still holding approval back. Zero with an
 * override, and an inconclusive check never counts.
 */
export function blockingCheckCount(
  record: PreMergeChecksRecord | null,
  override: PreMergeChecksOverride | null
): number {
  if (!record || override) return 0
  return record.results.filter(
    r => r.verdict === 'failed' && r.mode === 'error'
  ).length
}

// ── who may override ────────────────────────────────────────────────────────

export type OverrideEligibility =
  | { ok: true }
  | { ok: false; reason: 'author' | 'not_requested_reviewer' }

/**
 * PURE — may `login` override the checks on this PR? (The command path has
 * already checked write access.) With `reviewersOnly`, only a requested
 * reviewer — one GitHub still lists as requested, or one who has already
 * reviewed (GitHub drops a reviewer from the requested list once they
 * review) — and never the PR's author. Team review requests are not
 * expanded: a team member must be requested by name. Without it, the
 * author may override unless `authorAllowed` is false (the workspace turned
 * author approval off); an unknown author is refused then (it could be the
 * asker).
 */
export function overrideEligibility(input: {
  login: string
  authorLogin: string | null
  reviewersOnly: boolean
  authorAllowed: boolean
  requestedReviewers: readonly string[]
  reviewedBy: readonly string[]
}): OverrideEligibility {
  const me = input.login.toLowerCase()
  const author = input.authorLogin?.toLowerCase() ?? null
  if (input.reviewersOnly) {
    if (author === null || author === me) return { ok: false, reason: 'author' }
    const reviewers = new Set(
      [...input.requestedReviewers, ...input.reviewedBy].map(l =>
        l.toLowerCase()
      )
    )
    return reviewers.has(me)
      ? { ok: true }
      : { ok: false, reason: 'not_requested_reviewer' }
  }
  if (!input.authorAllowed && (author === null || author === me))
    return { ok: false, reason: 'author' }
  return { ok: true }
}

// ── the summary block ───────────────────────────────────────────────────────

const STATUS_LABEL: Record<PreMergeCheckStatus, string> = {
  error: '❌ Error',
  warning: '⚠️ Warning',
  passed: '✅ Passed',
  inconclusive: '❔ Inconclusive',
  ignored: '⏭️ Ignored',
  not_applicable: '➖ Not applicable',
}

/** A table cell: no pipes, code spans or line breaks from model / user text. */
function cell(text: string): string {
  return sanitizeField(text)
    .replace(/[`\r\n]/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function table(rows: string[][]): string {
  return [
    '| Check | Status | Explanation | Resolution |',
    '| --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.join(' | ')} |`),
  ].join('\n')
}

function row(r: PreMergeCheckResult, status: PreMergeCheckStatus): string[] {
  return [
    cell(neutralizeSummaryText(r.name, PRE_MERGE_CHECK_NAME_MAX)),
    STATUS_LABEL[status],
    cell(r.explanation) || '—',
    cell(r.resolution ?? '') || '—',
  ]
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * PURE — the "Pre-merge checks" block of the PR summary: the checks that did
 * not pass in a table, the passed ones folded, and what to do about an
 * `error`. Null when no check ran.
 */
export function formatPreMergeChecks(
  record: PreMergeChecksRecord | null,
  override: PreMergeChecksOverride | null,
  opts: { handle: string | null; requestChanges: boolean }
): string | null {
  if (!record || record.results.length === 0) return null
  const overridden = override !== null
  const shown = record.results.map(r => ({
    r,
    status: checkStatus(r, overridden),
  }))
  const settled = (st: PreMergeCheckStatus) =>
    st === 'passed' || st === 'not_applicable'
  const open = shown.filter(s => !settled(s.status))
  const folded = shown.filter(s => settled(s.status))
  const passed = shown.filter(s => s.status === 'passed')
  const na = shown.length - open.length - passed.length
  const tally = (st: PreMergeCheckStatus) =>
    shown.filter(s => s.status === st).length
  const parts = [
    tally('error') > 0 ? count(tally('error'), 'error') : null,
    tally('warning') > 0 ? count(tally('warning'), 'warning') : null,
    tally('ignored') > 0 ? `${tally('ignored')} ignored` : null,
    tally('inconclusive') > 0 ? `${tally('inconclusive')} inconclusive` : null,
    passed.length > 0 ? `${passed.length} passed` : null,
    na > 0 ? `${na} not applicable` : null,
  ].filter(Boolean)
  const blocks = [`**Pre-merge checks:** ${parts.join(' · ')}`]
  if (open.length > 0) blocks.push(table(open.map(s => row(s.r, s.status))))
  if (override) {
    const login = cell(override.login.replace(/[^\w-]/g, ''))
    const at = override.headSha ? ` at \`${override.headSha.slice(0, 7)}\`` : ''
    blocks.push(
      `Pre-merge checks are ignored on this PR — overridden by ${login}${at}; it covers every later push to this PR. Findings that block DONE are not affected.`
    )
  } else if (tally('error') > 0) {
    const how = opts.handle
      ? `fix them, or comment \`${opts.handle} ignore pre-merge checks\` to ignore the checks on this PR`
      : 'fix them'
    blocks.push(
      opts.requestChanges
        ? `Failed \`error\` checks keep Lumo's review at "Changes requested" — ${how}.`
        : `Failed \`error\` checks block the merge only with Lumo's request-changes workflow on (it is off in this workspace) — ${how}.`
    )
  }
  // LUM-1149: the per-requirement outcomes of the linked task / issue.
  for (const s of shown) {
    const block = formatRequirementsBlock(s.r.requirements)
    if (block) blocks.push(block)
  }
  if (folded.length > 0)
    blocks.push(
      `<details>\n<summary>${
        na > 0 ? 'Passed and not applicable checks' : 'Passed checks'
      } (${folded.length})</summary>\n\n${table(
        folded.map(s => row(s.r, s.status))
      )}\n\n</details>`
    )
  return blocks.join('\n\n')
}
