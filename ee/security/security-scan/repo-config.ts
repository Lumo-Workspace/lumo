/**
 * LUM-1146 — the repository config file (`.lumo.yaml`). PURE: parsing,
 * the field registry and the precedence; the loader
 * (ee/security/services/repo-config.service.ts) reads the file.
 *
 * Precedence, per value: the file on the PR's BASE commit > the repository's
 * Lumo settings > the workspace defaults. Every resolved value says where
 * it came from (`EffectiveReviewConfig`).
 *
 * Why the base commit: a PR must not weaken its own review (ignore itself,
 * drop path filters). The copy on the PR's branch takes effect only once it
 * is merged; until then the review only checks it and says so on the PR.
 * Each field declares what a PR-branch copy may do (`prBranch`) — in v1 it
 * is `'ignored'` for every key: each one decides whether or what is
 * reviewed, so a head copy could only loosen the review or spend the
 * owner's review budget. A future key that a PR may only TIGHTEN (e.g.
 * adding a pre-merge check) declares its own merge here.
 *
 * A file that does not parse or validate is never half-applied: the review
 * falls back to the Lumo settings and the PR summary says why. Unknown keys
 * are only warnings.
 */
import { LineCounter, parseDocument } from 'yaml'
import type { z } from 'zod'
import {
  REPO_CONFIG_MAX_BYTES,
  repoConfigSchema,
  type RepoConfigFile,
} from '@/ee/security/validation/repo-config'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  type RepoReviewSettingValues,
} from './auto-review-policy'

/** Problems / unknown keys kept per file (the rest are counted). */
export const REPO_CONFIG_MAX_PROBLEMS = 10

/** YAML anchors a file may expand (a config file needs none). */
const MAX_ALIAS_COUNT = 50

export type ParsedRepoConfig =
  | {
      ok: true
      config: RepoConfigFile
      /** Dotted paths of keys the schema does not know (ignored). */
      unknownKeys: string[]
    }
  | {
      ok: false
      /** `line 3: …` / `reviews.labels: …` — never the file's own text. */
      problems: string[]
    }

type Path = (string | number)[]

function dotted(path: readonly PropertyKey[]): string {
  return path
    .map(p => (typeof p === 'number' ? `[${p}]` : String(p)))
    .join('.')
    .replace(/\.\[/g, '[')
}

/** Duck-typed so it does not depend on Zod's internal class layout. */
function objectShape(schema: unknown): Record<string, unknown> | null {
  let s = schema as {
    shape?: Record<string, unknown>
    unwrap?: () => unknown
  } | null
  for (let i = 0; i < 10 && s; i++) {
    if (s.shape && typeof s.shape === 'object') return s.shape
    if (typeof s.unwrap !== 'function') return null
    s = s.unwrap() as typeof s
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** PURE — keys of `value` the schema has no slot for (dotted paths). */
export function unknownConfigKeys(
  schema: z.ZodType,
  value: unknown,
  path: Path = []
): string[] {
  const shape = objectShape(schema)
  if (!shape || !isRecord(value)) return []
  const out: string[] = []
  for (const [key, child] of Object.entries(value)) {
    // Own keys only: `constructor` / `toString` are unknown keys too.
    const slot = Object.prototype.hasOwnProperty.call(shape, key)
      ? shape[key]
      : undefined
    if (slot === undefined) out.push(dotted([...path, key]))
    else
      out.push(...unknownConfigKeys(slot as z.ZodType, child, [...path, key]))
  }
  return out
}

/** A key or message from the file as one short, inert line. */
function inert(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f`<>]/g, '').slice(0, 160)
}

/** PURE — `.lumo.yaml` text → the validated config, or why it is refused. */
export function parseRepoConfig(text: string): ParsedRepoConfig {
  if (Buffer.byteLength(text, 'utf8') > REPO_CONFIG_MAX_BYTES)
    return {
      ok: false,
      problems: [`the file is larger than ${REPO_CONFIG_MAX_BYTES} bytes`],
    }
  const lines = new LineCounter()
  const doc = parseDocument(text, {
    lineCounter: lines,
    prettyErrors: false,
    uniqueKeys: true,
  })
  if (doc.errors.length > 0)
    return {
      ok: false,
      problems: doc.errors.slice(0, REPO_CONFIG_MAX_PROBLEMS).map(e => {
        const { line } = lines.linePos(e.pos[0])
        return `line ${line}: ${inert(e.message)}`
      }),
    }
  let raw: unknown
  try {
    raw = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT })
  } catch (error) {
    return {
      ok: false,
      problems: [inert(error instanceof Error ? error.message : String(error))],
    }
  }
  // An empty file (or one holding only comments) configures nothing.
  if (raw === null || raw === undefined)
    return { ok: true, config: {}, unknownKeys: [] }
  if (!isRecord(raw))
    return {
      ok: false,
      problems: ['the file must be a mapping of keys (e.g. `reviews:`)'],
    }
  const parsed = repoConfigSchema.safeParse(raw)
  if (!parsed.success)
    return {
      ok: false,
      problems: parsed.error.issues
        .slice(0, REPO_CONFIG_MAX_PROBLEMS)
        .map(issue => {
          const node = doc.getIn(issue.path as Path, true) as
            | { range?: [number, number, number] }
            | undefined
          const at = node?.range
            ? `line ${lines.linePos(node.range[0]).line}, `
            : ''
          const key = issue.path.length > 0 ? dotted(issue.path) : '(root)'
          return `${at}${inert(key)}: ${inert(issue.message)}`
        }),
    }
  return {
    ok: true,
    config: parsed.data,
    unknownKeys: unknownConfigKeys(repoConfigSchema, raw)
      .slice(0, REPO_CONFIG_MAX_PROBLEMS)
      .map(inert),
  }
}

// ── field registry (the extension point) ────────────────────────────────────

/** Where a resolved value came from. */
export type ConfigValueSource = 'file' | 'repository' | 'default'

export interface RepoConfigField<V> {
  /** Dotted YAML path, as users write it. */
  key: string
  /** The file's value; undefined = the file does not set it. */
  read: (file: RepoConfigFile) => V | undefined
  /** The Lumo setting this key overrides; absent = a file-only key. */
  lumo?: (settings: RepoReviewSettingValues) => V
  /** Used when neither the file nor a stored Lumo setting gives one. */
  fallback: V
  /**
   * What a copy of the file on the PR's own branch may do with this key.
   * v1: `'ignored'` everywhere (see the module comment).
   */
  prBranch: 'ignored'
}

function field<V>(f: RepoConfigField<V>): RepoConfigField<V> {
  return f
}

/** Trimmed, without blanks, first occurrence kept (as the settings card). */
function cleanList(list: readonly string[] | undefined): string[] | undefined {
  if (list === undefined) return undefined
  return [...new Set(list.map(v => v.trim()).filter(v => v.length > 0))]
}

const D = DEFAULT_REPO_REVIEW_SETTING

/**
 * Every key the file resolves, in display order. Adding a key: see
 * ee/security/validation/repo-config.ts.
 */
export const REPO_CONFIG_FIELDS = {
  autoReview: field<boolean>({
    key: 'reviews.auto_review.enabled',
    read: f => f.reviews?.auto_review?.enabled,
    lumo: s => s.autoReview,
    fallback: D.autoReview,
    prBranch: 'ignored',
  }),
  reviewDrafts: field<boolean>({
    key: 'reviews.auto_review.drafts',
    read: f => f.reviews?.auto_review?.drafts,
    lumo: s => s.reviewDrafts,
    fallback: D.reviewDrafts,
    prBranch: 'ignored',
  }),
  baseBranches: field<string[]>({
    key: 'reviews.auto_review.base_branches',
    read: f => cleanList(f.reviews?.auto_review?.base_branches),
    lumo: s => s.baseBranches,
    fallback: [...D.baseBranches],
    prBranch: 'ignored',
  }),
  labels: field<string[]>({
    key: 'reviews.auto_review.labels',
    read: f => cleanList(f.reviews?.auto_review?.labels),
    lumo: s => s.labels,
    fallback: [...D.labels],
    prBranch: 'ignored',
  }),
  ignoreTitleKeywords: field<string[]>({
    key: 'reviews.auto_review.ignore_title_keywords',
    read: f => cleanList(f.reviews?.auto_review?.ignore_title_keywords),
    lumo: s => s.ignoreTitleKeywords,
    fallback: [...D.ignoreTitleKeywords],
    prBranch: 'ignored',
  }),
  ignoreUsernames: field<string[]>({
    key: 'reviews.auto_review.ignore_usernames',
    read: f => cleanList(f.reviews?.auto_review?.ignore_usernames),
    lumo: s => s.ignoreUsernames,
    fallback: [...D.ignoreUsernames],
    prBranch: 'ignored',
  }),
  descriptionKeyword: field<string | null>({
    key: 'reviews.auto_review.description_keyword',
    read: f => {
      const k = f.reviews?.auto_review?.description_keyword
      if (k === undefined) return undefined
      const t = k?.trim() ?? ''
      return t.length > 0 ? t : null
    },
    lumo: s => s.descriptionKeyword,
    fallback: D.descriptionKeyword,
    prBranch: 'ignored',
  }),
  pathFilters: field<string[]>({
    key: 'reviews.path_filters',
    read: f => cleanList(f.reviews?.path_filters),
    lumo: s => s.pathFilters,
    fallback: [...D.pathFilters],
    prBranch: 'ignored',
  }),
} as const

export type RepoConfigFields = typeof REPO_CONFIG_FIELDS
export type RepoConfigFieldName = keyof RepoConfigFields
type FieldValue<K extends RepoConfigFieldName> =
  RepoConfigFields[K] extends RepoConfigField<infer V> ? V : never

export type EffectiveReviewConfig = {
  [K in RepoConfigFieldName]: {
    value: FieldValue<K>
    source: ConfigValueSource
    /** The YAML key that sets it. */
    key: string
  }
}

export interface LumoReviewSettings {
  values: RepoReviewSettingValues
  /** The repository has a stored settings row (else: workspace defaults). */
  stored: boolean
}

/**
 * PURE — every key's value and where it came from: the file (when it sets
 * the key) > the repository's stored Lumo setting > the default. `file` is
 * the BASE commit's validated config, or null (absent / invalid / unread).
 */
export function effectiveReviewConfig(
  lumo: LumoReviewSettings,
  file: RepoConfigFile | null
): EffectiveReviewConfig {
  const out: Record<string, unknown> = {}
  for (const name of Object.keys(REPO_CONFIG_FIELDS) as RepoConfigFieldName[]) {
    const f = REPO_CONFIG_FIELDS[name] as RepoConfigField<unknown>
    const fromFile = file ? f.read(file) : undefined
    if (fromFile !== undefined) {
      out[name] = { value: fromFile, source: 'file', key: f.key }
    } else if (f.lumo && lumo.stored) {
      out[name] = {
        value: f.lumo(lumo.values),
        source: 'repository',
        key: f.key,
      }
    } else {
      out[name] = {
        value: f.fallback,
        source: 'default',
        key: f.key,
      }
    }
  }
  return out as EffectiveReviewConfig
}

/**
 * PURE — the repository's review settings with the file applied over them
 * (what the auto-review filters and the path filters read). Keys the file
 * cannot set (`emptyBaseBranchesMeans`) keep the stored value.
 */
export function reviewSettingsWithFile(
  settings: RepoReviewSettingValues,
  file: RepoConfigFile | null
): RepoReviewSettingValues {
  if (!file) return settings
  const e = effectiveReviewConfig({ values: settings, stored: true }, file)
  return {
    ...settings,
    autoReview: e.autoReview.value,
    reviewDrafts: e.reviewDrafts.value,
    baseBranches: e.baseBranches.value,
    labels: e.labels.value,
    ignoreTitleKeywords: e.ignoreTitleKeywords.value,
    ignoreUsernames: e.ignoreUsernames.value,
    descriptionKeyword: e.descriptionKeyword.value,
    pathFilters: e.pathFilters.value,
  }
}

// ── what the PR summary says about the file ─────────────────────────────────

/**
 * How the file was read for one review:
 *  - `absent`     no `.lumo.yaml` on the base commit (nothing to say);
 *  - `loaded`     applied (`unknownKeys` were ignored);
 *  - `invalid`    did not parse / validate — NOT applied, Lumo settings used;
 *  - `unreadable` GitHub did not return it — Lumo settings used.
 */
export type RepoConfigStatus = 'absent' | 'loaded' | 'invalid' | 'unreadable'

export interface RepoConfigFileState {
  status: RepoConfigStatus
  /** The commit it was read at (null = unknown). */
  sha: string | null
  problems: string[]
  unknownKeys: string[]
}

/** Stored on the scan row (`PrSecurityScan.repoConfig`), read by the summary. */
export interface RepoConfigNotice {
  /** The base branch name, for the summary's wording. */
  baseRef: string | null
  base: RepoConfigFileState
  /**
   * The PR changes `.lumo.yaml`: its own copy, checked but not applied
   * (`absent` = the PR deletes it). Null = the PR does not touch it.
   */
  prBranch: RepoConfigFileState | null
}

export type RepoConfigLoad =
  | { status: 'absent' }
  | { status: 'loaded'; config: RepoConfigFile; unknownKeys: string[] }
  | { status: 'invalid'; problems: string[] }
  | { status: 'unreadable' }

/** PURE — what a load result says, for the notice. */
export function fileStateOf(
  load: RepoConfigLoad,
  sha: string | null
): RepoConfigFileState {
  return {
    status: load.status,
    sha,
    problems: load.status === 'invalid' ? load.problems : [],
    unknownKeys: load.status === 'loaded' ? load.unknownKeys : [],
  }
}

/** PURE — the parsed text as a load result. */
export function loadFromText(text: string | null): RepoConfigLoad {
  if (text === null) return { status: 'absent' }
  const parsed = parseRepoConfig(text)
  return parsed.ok
    ? {
        status: 'loaded',
        config: parsed.config,
        unknownKeys: parsed.unknownKeys,
      }
    : { status: 'invalid', problems: parsed.problems }
}

const STATUSES = new Set<RepoConfigStatus>([
  'absent',
  'loaded',
  'invalid',
  'unreadable',
])

function strings(v: unknown): string[] {
  return Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === 'string')
        .slice(0, REPO_CONFIG_MAX_PROBLEMS)
        .map(inert)
    : []
}

function parseFileState(raw: unknown): RepoConfigFileState | null {
  if (!isRecord(raw)) return null
  const status = raw.status as RepoConfigStatus
  if (!STATUSES.has(status)) return null
  return {
    status,
    sha: typeof raw.sha === 'string' ? raw.sha : null,
    problems: strings(raw.problems),
    unknownKeys: strings(raw.unknownKeys),
  }
}

/** PURE — the stored Json back as a notice; anything malformed reads as null. */
export function parseRepoConfigNotice(raw: unknown): RepoConfigNotice | null {
  if (!isRecord(raw)) return null
  const base = parseFileState(raw.base)
  if (!base) return null
  return {
    baseRef: typeof raw.baseRef === 'string' ? inert(raw.baseRef) : null,
    base,
    prBranch: parseFileState(raw.prBranch),
  }
}

/** PURE — the PR's diff changes `path` (added, edited, renamed or deleted). */
export function diffTouchesRepoConfig(diff: string, path: string): boolean {
  // Header lines only; a CR (CRLF diff) and a quoted side ("a/x y") are fine.
  for (const raw of diff.split('\n')) {
    if (!raw.startsWith('diff --git ')) continue
    const line = raw.replace(/\r$/, '')
    if (
      line.startsWith(`diff --git a/${path} `) ||
      line.startsWith(`diff --git "a/${path}" `) ||
      line.endsWith(` b/${path}`) ||
      line.endsWith(` "b/${path}"`)
    )
      return true
  }
  return false
}
