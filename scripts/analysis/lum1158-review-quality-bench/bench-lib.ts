/**
 * LUM-1158 — pure helpers of the review quality benchmark (no I/O, no model
 * calls), shared by the pipeline scripts and unit-tested on their own.
 *
 * The benchmark scores two reviewers on the same merged PRs, at the commit
 * the reviewer of record reviewed ("hash X"):
 *
 *   - `bot-a` — the industry-reference review bot, anonymised everywhere in
 *     this repository; its real login is only ever passed in at run time
 *     (`BENCH_REFERENCE_LOGIN`), never written to a file;
 *   - `lumo`  — Lumo's shipped AI review (review → verifier → ranker), replayed.
 *
 * Ground truth = the fixes the developers made in the commits pushed after
 * hash X (an LLM lists them from those commits). A finding is a true positive
 * when the judge matches it to one of those fixes.
 */
import path from 'node:path'
import { RANKER_KEEP_THRESHOLD } from '@/ee/security/security-scan/verifier'

/** The anonymised label of the reference reviewer. Never its real name. */
export const REFERENCE_LABEL = 'bot-a'
export type ReviewerLabel = typeof REFERENCE_LABEL | 'lumo'

/** `oss`: public PRs bot-a reviewed. `own`: Lumo's own PRs (Lumo-only rows). */
export type BenchSource = 'oss' | 'own'

export interface ManifestEntry {
  /** Stable row id, e.g. `oss-07` / `own-03`. */
  id: string
  url: string
  repo: string
  number: number
  source: BenchSource
  /** Whose review fixed hash X: bot-a for oss rows, lumo for own rows. */
  reviewerOfRecord: ReviewerLabel
  /** The commit the reviewer of record first reviewed. */
  hashX: string
  /** PR base commit (diff = base...hashX). */
  base: string
  /** PR head at merge (the post-review commits end here). */
  head: string
  /** SPDX id of the repository license at discovery time. */
  license: string
  stars: number
  changedLines: number
  /** Non-merge commits pushed after hash X. */
  postReviewCommits: number
  mergedAt: string
}

export interface Manifest {
  version: 1
  createdAt: string
  reference: typeof REFERENCE_LABEL
  /** The selection rules the rows were drawn with, for re-drawing. */
  criteria: Record<string, string | number | boolean>
  prs: ManifestEntry[]
}

/**
 * OSI-permissive licenses whose PR content we process (it never leaves the
 * scratch dir; only url + SHAs are committed). Copyleft and unlicensed repos
 * are left out of the sample.
 */
export const PERMISSIVE_LICENSES: ReadonlySet<string> = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'Unlicense',
  'MPL-2.0',
])

export function isPermissiveLicense(spdx: string | null | undefined): boolean {
  return spdx != null && PERMISSIVE_LICENSES.has(spdx)
}

const SHA = /^[0-9a-f]{40}$/
const PR_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)$/

/** Problems with a manifest; empty when it is well formed and anonymised. */
export function validateManifest(m: Manifest): string[] {
  const errors: string[] = []
  if (m.version !== 1) errors.push('version must be 1')
  if (m.reference !== REFERENCE_LABEL)
    errors.push(`reference must be ${REFERENCE_LABEL}`)
  const ids = new Set<string>()
  for (const p of m.prs) {
    const at = p.id || p.url
    if (!/^(oss|own)-\d{2,}$/.test(p.id)) errors.push(`${at}: bad id`)
    if (ids.has(p.id)) errors.push(`${at}: duplicate id`)
    ids.add(p.id)
    const u = PR_URL.exec(p.url)
    if (!u || u[1] !== p.repo || Number(u[2]) !== p.number)
      errors.push(`${at}: url does not match repo/number`)
    for (const k of ['hashX', 'base', 'head'] as const)
      if (!SHA.test(p[k])) errors.push(`${at}: ${k} is not a full sha`)
    const expected = p.source === 'oss' ? REFERENCE_LABEL : 'lumo'
    if (p.reviewerOfRecord !== expected)
      errors.push(`${at}: reviewerOfRecord must be ${expected}`)
    if (!p.id.startsWith(`${p.source}-`))
      errors.push(`${at}: id prefix must match source`)
    if (p.source === 'oss' && !isPermissiveLicense(p.license))
      errors.push(`${at}: license ${p.license} not in the permissive allowlist`)
    if (p.postReviewCommits < 1)
      errors.push(`${at}: no post-review commits (no ground truth)`)
  }
  return errors
}

// ---------------------------------------------------------------- GitHub data

export interface GhReview {
  user: { login: string } | null
  commit_id: string | null
  submitted_at: string | null
  body: string | null
}

export interface GhReviewComment {
  user: { login: string } | null
  original_commit_id: string
  path: string
  line: number | null
  original_line: number | null
  body: string
  in_reply_to_id?: number
}

export interface GhCommit {
  sha: string
  parents: ReadonlyArray<{ sha: string }>
}

/** The commit `login` reviewed first (its earliest submitted review), or null. */
export function findReviewCommit(
  reviews: readonly GhReview[],
  login: string
): string | null {
  const mine = reviews
    .filter(r => r.user?.login === login && r.commit_id && r.submitted_at)
    .sort((a, b) => a.submitted_at!.localeCompare(b.submitted_at!))
  return mine[0]?.commit_id ?? null
}

/**
 * The non-merge commits pushed after `hashX`, in PR order. Null when hash X
 * is no longer in the PR's history (force-pushed away): the post-review
 * changes cannot be told apart then, so the PR is skipped.
 */
export function commitsAfter(
  commits: readonly GhCommit[],
  hashX: string
): GhCommit[] | null {
  const i = commits.findIndex(c => c.sha === hashX)
  if (i < 0) return null
  return commits.slice(i + 1).filter(c => c.parents.length <= 1)
}

/**
 * The HTML tags review bots wrap their markdown in. Only these are stripped:
 * a generic pattern would also eat code such as `Array<string>`.
 */
const HTML_TAG =
  /<\/?(?:details|summary|sub|sup|br|p|b|i|a|img|code|pre|blockquote|div|span|table|thead|tbody|tr|td|th|ul|ol|li|h[1-6]|hr|em|strong)(?:\s[^>]*)?\/?>/gi

/** Strip HTML comments/tags and collapse blank runs; cap at `max` chars. */
export function plainReviewText(body: string, max = 4000): string {
  const text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(HTML_TAG, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export interface ReferenceReviewText {
  inline: Array<{ path: string; line: number | null; body: string }>
  bodies: string[]
}

/**
 * What `login` said in its review of hash X: top-level inline comments made
 * on that commit and the bodies of its reviews of that commit. Replies and
 * later rounds are left out, so the reference is scored on the same code
 * Lumo saw.
 */
export function referenceReviewAt(
  reviews: readonly GhReview[],
  comments: readonly GhReviewComment[],
  login: string,
  hashX: string
): ReferenceReviewText {
  const inline = comments
    .filter(
      c =>
        c.user?.login === login &&
        c.original_commit_id === hashX &&
        c.in_reply_to_id == null
    )
    .map(c => ({
      path: c.path,
      line: c.line ?? c.original_line,
      body: plainReviewText(c.body),
    }))
    .filter(c => c.body !== '')
  const bodies = reviews
    .filter(r => r.user?.login === login && r.commit_id === hashX && r.body)
    .map(r => plainReviewText(r.body!, 12000))
    .filter(b => b !== '')
  return { inline, bodies }
}

/** Is `target` (resolved) inside `dir` (resolved)? Pure path arithmetic. */
export function insideDir(dir: string, target: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(target))
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Paths a unified diff adds or modifies (deleted files are `+++ /dev/null`). */
export function changedPaths(diff: string): string[] {
  const out: string[] = []
  for (const line of diff.split('\n'))
    if (line.startsWith('+++ b/')) out.push(line.slice(6).replace(/\t$/, ''))
  return out
}

// ---------------------------------------------------------- Lumo's findings

/** verify.ts SECURITY_KINDS: production never lets the verifier/ranker drop these. */
export const SECURITY_REVIEW_KINDS: ReadonlySet<string> = new Set([
  'sql_injection',
  'command_injection',
  'xss',
  'ssrf',
  'path_traversal',
  'insecure_deserialization',
  'auth_bypass',
  'unsafe_eval',
  'weak_crypto',
  'hardcoded_credential',
  'csrf',
  'clickjacking_or_insecure_headers',
  'origin_or_host_validation',
  'open_redirect',
  'authz_logic',
])

export interface ReplayFinding {
  kind: string
  severity: string
  filePath: string
  line: number | null
  title: string
  detail: string
}

export interface ReplayRunResult {
  findings?: ReplayFinding[]
  skipped?: string
  error?: string
}

/**
 * The findings production would post for one replay run: the verifier's
 * rejections, then the ranker's p < RANKER_KEEP_THRESHOLD, both only on
 * non-HIGH non-security rows (the replay-space form of
 * `applyVerifierPolicy` + `applyRankerPolicy`, as LUM-1010 applied it).
 * Null when the run produced no findings list (over cap / error).
 */
export function keptLumoFindings(
  run: ReplayRunResult | undefined,
  verify: { results?: Array<{ id: string; verdict: string }> } | undefined,
  rank: { ranking?: Array<{ id: string; p: number }> } | undefined,
  threshold = RANKER_KEEP_THRESHOLD
): Array<ReplayFinding & { id: string }> | null {
  if (!run?.findings) return null
  const findings = run.findings.map((f, i) => ({ ...f, id: `f${i}` }))
  const applicable = (f: ReplayFinding) =>
    f.severity !== 'HIGH' && !SECURITY_REVIEW_KINDS.has(f.kind)
  const byId = new Map(findings.map(f => [f.id, f]))
  const rejected = new Set<string>()
  for (const r of verify?.results ?? []) {
    const f = byId.get(r.id)
    if (f && r.verdict === 'REJECTED' && applicable(f)) rejected.add(f.id)
  }
  for (const r of rank?.ranking ?? []) {
    const f = byId.get(r.id)
    if (f && applicable(f) && r.p < threshold) rejected.add(f.id)
  }
  return findings.filter(f => !rejected.has(f.id))
}

// ---------------------------------------------------------------- scoring

/** One reviewer's finding as the judge sees it (both sides share the shape). */
export interface BenchFinding {
  id: string
  filePath: string | null
  line: number | null
  /** bug | security | performance | test | docs | refactor | nitpick | other */
  category: string
  text: string
}

export interface BenchFix {
  id: string
  filePath: string | null
  text: string
}

export interface Usage {
  inputTokens: number
  outputTokens: number
}

/** label.ts's per-PR cache entry (<data>/labels.json). */
export interface PrLabels {
  model: string
  fixes?: BenchFix[]
  reference?: BenchFinding[]
  usage: { truth?: Usage; reference?: Usage }
  error?: string
}

export interface Match {
  findingId: string
  fixId: string
}

/** Keep only matches whose ids exist, at most once per (finding, fix). */
export function cleanMatches(
  matches: readonly Match[],
  findings: readonly { id: string }[],
  fixes: readonly { id: string }[]
): Match[] {
  const f = new Set(findings.map(x => x.id))
  const x = new Set(fixes.map(y => y.id))
  const seen = new Set<string>()
  return matches.filter(m => {
    const key = `${m.findingId}\u0000${m.fixId}`
    if (!f.has(m.findingId) || !x.has(m.fixId) || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export interface PrScore {
  findings: number
  matchedFindings: number
  fixes: number
  matchedFixes: number
  /** Findings the developers did not act on — the noise a reader wades through. */
  noise: number
  matchedFixIds: string[]
}

export function scorePr(
  findings: readonly { id: string }[],
  fixes: readonly { id: string }[],
  matches: readonly Match[]
): PrScore {
  const ok = cleanMatches(matches, findings, fixes)
  const mf = new Set(ok.map(m => m.findingId))
  const mx = [...new Set(ok.map(m => m.fixId))].sort()
  return {
    findings: findings.length,
    matchedFindings: mf.size,
    fixes: fixes.length,
    matchedFixes: mx.length,
    noise: findings.length - mf.size,
    matchedFixIds: mx,
  }
}

/** judge.ts's per-PR row (<data>/judged.json, under a tag). */
export interface JudgedPr {
  score: PrScore
  findings: BenchFinding[]
  matches: Array<Match & { reason: string }>
  /** Lumo posted nothing (over cap / error), or bot-a's labels are missing. */
  skipped?: string
  usage?: Usage
}

export function fBeta(p: number, r: number, beta: number): number {
  const b2 = beta * beta
  return p + r > 0 ? ((1 + b2) * p * r) / (b2 * p + r) : 0
}

export interface Pooled {
  prs: number
  precision: number
  recall: number
  f1: number
  f2: number
  findings: number
  matchedFindings: number
  fixes: number
  matchedFixes: number
  /** Mean unmatched findings per PR. */
  noisePerPr: number
  /** Mean findings per PR. */
  findingsPerPr: number
}

/** Micro-pooled over PRs: P = matched findings / findings, R = matched fixes / fixes. */
export function pooled(rows: readonly PrScore[]): Pooled {
  const sum = (k: keyof Omit<PrScore, 'matchedFixIds'>) =>
    rows.reduce((s, r) => s + r[k], 0)
  const findings = sum('findings')
  const matchedFindings = sum('matchedFindings')
  const fixes = sum('fixes')
  const matchedFixes = sum('matchedFixes')
  const precision = findings ? matchedFindings / findings : 0
  const recall = fixes ? matchedFixes / fixes : 0
  const n = rows.length
  return {
    prs: n,
    precision,
    recall,
    f1: fBeta(precision, recall, 1),
    f2: fBeta(precision, recall, 2),
    findings,
    matchedFindings,
    fixes,
    matchedFixes,
    noisePerPr: n ? sum('noise') / n : 0,
    findingsPerPr: n ? findings / n : 0,
  }
}

/**
 * Lumo's recall split by where a fix came from: fixes bot-a's own comment
 * pointed at (bot-a gets causal credit for those, Lumo cannot) versus every
 * other fix — the fair head-to-head is on the second group.
 */
export function splitRecall(
  rows: ReadonlyArray<{ lumo: PrScore; reference: PrScore }>
): {
  pointed: { hit: number; total: number }
  other: { hit: number; total: number }
} {
  let ph = 0
  let pt = 0
  let oh = 0
  let ot = 0
  for (const { lumo, reference } of rows) {
    const pointed = new Set(reference.matchedFixIds)
    pt += pointed.size
    ot += reference.fixes - pointed.size
    for (const id of lumo.matchedFixIds) {
      if (pointed.has(id)) ph++
      else oh++
    }
  }
  return {
    pointed: { hit: ph, total: pt },
    other: { hit: oh, total: ot },
  }
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`
const num = (x: number) => (100 * x).toFixed(1)

/** One markdown table row for a pooled score. */
export function pooledRow(label: string, p: Pooled): string {
  return `| ${label} | ${p.prs} | ${pct(p.precision)} | ${pct(p.recall)} | ${num(p.f1)} | ${num(p.f2)} | ${p.findingsPerPr.toFixed(1)} | ${p.noisePerPr.toFixed(1)} | ${p.matchedFindings}/${p.findings} | ${p.matchedFixes}/${p.fixes} |`
}

export const POOLED_HEADER = [
  '| Reviewer | PRs | P | R | F1 | F2 | findings/PR | noise/PR | matched findings | matched fixes |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
].join('\n')

// ---------------------------------------------------------------- utilities

/** Deterministic PRNG (mulberry32) so a seed re-draws the same sample. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher–Yates with the given PRNG; returns a new array. */
export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/** Calendar days from `start` to `end` inclusive, as YYYY-MM-DD (UTC). */
export function dayRange(start: string, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  const last = new Date(`${end}T00:00:00Z`)
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

/** The benchmark category of a Lumo review kind (replay-space `kind`). */
export function lumoCategory(kind: string): string {
  if (SECURITY_REVIEW_KINDS.has(kind)) return 'security'
  if (kind.includes('test')) return 'test'
  if (kind.includes('doc')) return 'docs'
  if (kind.includes('perf')) return 'performance'
  return 'bug'
}

/** A kept Lumo finding in the judge's shape. */
export function lumoBenchFinding(
  f: ReplayFinding & { id: string }
): BenchFinding {
  return {
    id: f.id,
    filePath: f.filePath || null,
    line: f.line,
    category: lumoCategory(f.kind),
    text: `${f.title} — ${f.detail}`,
  }
}
