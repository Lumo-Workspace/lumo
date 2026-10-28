/**
 * LUM-1146 — reads the repository config file (`.lumo.yaml`) for a review.
 * Never throws and never fails a scan: a missing file is "absent", a file
 * that does not parse / validate is "invalid", a read GitHub refused is
 * "unreadable" — the last two fall back to the Lumo settings, and the PR
 * summary says so (ee/security/security-scan/repo-config.ts has the rules).
 *
 * Cached per (workspace, repository, commit sha): a commit's content never
 * changes, so a hit is always right. The workspace is part of the key so a
 * cached read never skips the token mint that checks the workspace
 * confirmed the repository (LUM-883). Only exact commit shas are cached, and
 * never an unreadable result (that one is retried on the next read).
 *
 * The GitHub helpers are imported lazily: the auto-review decision imports
 * this module, and the token minting behind them must not load (or fail to
 * load) on a path that never reads a file.
 */
import {
  gitProviderFor,
  gitProviderRefOf,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import {
  DEFAULT_HIGH_LEVEL_SUMMARY,
  parseHighLevelSummary,
  type HighLevelSummaryMode,
} from '@/ee/security/security-scan/pr-description-summary'
import { logger } from '@/lib/logger'
import { repoReviewSettingRepository } from '@/ee/security/repositories/repo-review-setting.repository'
import { REPO_CONFIG_PATH } from '@/ee/security/validation/repo-config'
import type { RepoConfigFile } from '@/ee/security/validation/repo-config'
import {
  DEFAULT_REPO_REVIEW_SETTING,
  type RepoReviewSettingValues,
} from '@/ee/security/security-scan/auto-review-policy'
import {
  REPO_CONFIG_FIELDS,
  diffTouchesRepoConfig,
  effectiveReviewConfig,
  fileStateOf,
  loadFromText,
  type EffectiveReviewConfig,
  type RepoConfigFileState,
  type RepoConfigLoad,
  type RepoConfigNotice,
} from '@/ee/security/security-scan/repo-config'

/** Entries kept; the oldest goes first. */
export const REPO_CONFIG_CACHE_MAX = 500

const COMMIT_SHA = /^[0-9a-f]{40}$/i

const cache = new Map<string, RepoConfigLoad>()

function cacheKey(workspaceId: string, repo: string, sha: string): string {
  return `${workspaceId}\u0000${repo.toLowerCase()}\u0000${sha.toLowerCase()}`
}

function remember(key: string, load: RepoConfigLoad): void {
  if (load.status === 'unreadable') return
  cache.delete(key)
  cache.set(key, load)
  while (cache.size > REPO_CONFIG_CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cache.delete(oldest)
  }
}

/** Test seam: empty the per-process cache. */
export function clearRepoConfigCache(): void {
  cache.clear()
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export interface RepoConfigForPr {
  /** The base commit's config to apply; null = use the Lumo settings. */
  file: RepoConfigFile | null
  /** What the PR summary says about the file. */
  notice: RepoConfigNotice
}

export interface EffectiveRepoConfig {
  /** Each key's value and where it came from. */
  config: EffectiveReviewConfig
  /** How the file was read (at `sha`). */
  file: RepoConfigFileState
  /** The branch it was read from. */
  ref: string | null
}

export const repoConfigService = {
  /** The file at one commit. Never throws. */
  async loadAt(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      sha: string
    }
  ): Promise<RepoConfigLoad> {
    const cacheable = COMMIT_SHA.test(input.sha)
    const key = cacheKey(input.workspaceId, input.repo, input.sha)
    const hit = cacheable ? cache.get(key) : undefined
    if (hit) return hit
    let load: RepoConfigLoad
    try {
      const { readRepoFile } = gitProviderFor(input)
      const text = await readRepoFile({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        path: REPO_CONFIG_PATH,
        ref: input.sha,
      })
      load = loadFromText(text)
    } catch (error) {
      logger.warn(
        `[repo-config] ${REPO_CONFIG_PATH} unreadable repo=${input.repo} sha=${input.sha}: ${describe(error)}`
      )
      load = { status: 'unreadable' }
    }
    if (cacheable) remember(key, load)
    return load
  },

  /**
   * The base commit's config to apply to an auto-review decision; null when
   * there is none to apply (absent, invalid, unreadable, unknown base).
   * Never throws.
   */
  async fileForDecision(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      baseSha: string | null | undefined
    }
  ): Promise<RepoConfigFile | null> {
    if (!input.baseSha) return null
    const load = await repoConfigService.loadAt({
      ...gitProviderRefOf(input),
      workspaceId: input.workspaceId,
      repo: input.repo,
      sha: input.baseSha,
    })
    return load.status === 'loaded' ? load.config : null
  },

  /**
   * For a scan: the config on the PR's BASE commit (applied), plus — when
   * the PR's diff changes `.lumo.yaml` — its own copy at `headSha`, checked
   * but never applied. Never throws.
   */
  async forPullRequest(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      prNumber: number
      headSha: string
      diff: string
    }
  ): Promise<RepoConfigForPr> {
    let base: { ref: string; sha: string } | null = null
    try {
      const { fetchPrBase } = gitProviderFor(input)
      base = await fetchPrBase({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        prNumber: input.prNumber,
      })
    } catch (error) {
      logger.warn(
        `[repo-config] PR base unavailable ${input.repo}#${input.prNumber}: ${describe(error)}`
      )
    }
    const baseLoad: RepoConfigLoad = base
      ? await repoConfigService.loadAt({
          ...gitProviderRefOf(input),
          workspaceId: input.workspaceId,
          repo: input.repo,
          sha: base.sha,
        })
      : { status: 'unreadable' }
    const prBranch = diffTouchesRepoConfig(input.diff, REPO_CONFIG_PATH)
      ? fileStateOf(
          await repoConfigService.loadAt({
            ...gitProviderRefOf(input),
            workspaceId: input.workspaceId,
            repo: input.repo,
            sha: input.headSha,
          }),
          input.headSha
        )
      : null
    return {
      file: baseLoad.status === 'loaded' ? baseLoad.config : null,
      notice: {
        baseRef: base?.ref ?? null,
        base: fileStateOf(baseLoad, base?.sha ?? null),
        prBranch,
      },
    }
  },

  /**
   * LUM-1147 — the tone a PR chat answer is written in: `tone_instructions`
   * from `.lumo.yaml` on the PR's base commit, else the repository's stored
   * tone, else none. Never throws (any failure = the stored tone, or none).
   */
  async toneForPullRequest(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      prNumber: number
    }
  ): Promise<string | null> {
    let stored: string | null = null
    try {
      stored =
        (
          await repoReviewSettingRepository.findReviewStyle(
            input.workspaceId,
            input.repo.toLowerCase()
          )
        )?.toneInstructions ?? null
    } catch (error) {
      logger.warn(
        `[repo-config] stored tone unavailable repo=${input.repo}: ${describe(error)}`
      )
    }
    try {
      const { fetchPrBase } = gitProviderFor(input)
      const base = await fetchPrBase({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        prNumber: input.prNumber,
      })
      const load = await repoConfigService.loadAt({
        ...gitProviderRefOf(input),
        workspaceId: input.workspaceId,
        repo: input.repo,
        sha: base.sha,
      })
      if (load.status === 'loaded') {
        const fromFile = REPO_CONFIG_FIELDS.toneInstructions.read(load.config)
        if (fromFile !== undefined) return fromFile
      }
    } catch (error) {
      logger.warn(
        `[repo-config] PR base unavailable for tone ${input.repo}#${input.prNumber}: ${describe(error)}`
      )
    }
    return stored
  },

  /**
   * LUM-1151 — where the high-level summary goes for this PR NOW (for
   * `@<app> summary`): `reviews.high_level_summary` from `.lumo.yaml` on
   * the PR's base commit, else the repository's stored setting, else the
   * default. Never throws (any failure = the stored setting, or default).
   */
  async highLevelSummaryForPullRequest(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      prNumber: number
    }
  ): Promise<HighLevelSummaryMode> {
    let stored: HighLevelSummaryMode = DEFAULT_HIGH_LEVEL_SUMMARY
    try {
      const style = await repoReviewSettingRepository.findReviewStyle(
        input.workspaceId,
        input.repo.toLowerCase()
      )
      if (style) stored = parseHighLevelSummary(style.highLevelSummary)
    } catch (error) {
      logger.warn(
        `[repo-config] stored summary setting unavailable repo=${input.repo}: ${describe(error)}`
      )
    }
    try {
      const { fetchPrBase } = gitProviderFor(input)
      const base = await fetchPrBase({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        prNumber: input.prNumber,
      })
      const load = await repoConfigService.loadAt({
        ...gitProviderRefOf(input),
        workspaceId: input.workspaceId,
        repo: input.repo,
        sha: base.sha,
      })
      if (load.status === 'loaded') {
        const fromFile = REPO_CONFIG_FIELDS.highLevelSummary.read(load.config)
        if (fromFile !== undefined) return fromFile
      }
    } catch (error) {
      logger.warn(
        `[repo-config] PR base unavailable for the summary setting ${input.repo}#${input.prNumber}: ${describe(error)}`
      )
    }
    return stored
  },

  /**
   * LUM-1155 — for `@<app> diagram`: whether the repository wants call-flow
   * diagrams NOW and the path filters the diagram reads, each from
   * `.lumo.yaml` on the PR's base commit, else the repository's stored
   * setting, else the default. Never throws (any failure = the stored
   * settings, or the defaults).
   */
  async sequenceDiagramSettingsForPullRequest(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      prNumber: number
    }
  ): Promise<{ enabled: boolean; pathFilters: string[] }> {
    let enabled = DEFAULT_REPO_REVIEW_SETTING.sequenceDiagrams
    let pathFilters: string[] = [...DEFAULT_REPO_REVIEW_SETTING.pathFilters]
    try {
      const [style, filters] = await Promise.all([
        repoReviewSettingRepository.findReviewStyle(
          input.workspaceId,
          input.repo.toLowerCase()
        ),
        repoReviewSettingRepository.findPathFilters(
          input.workspaceId,
          input.repo.toLowerCase()
        ),
      ])
      if (style && typeof style.sequenceDiagrams === 'boolean')
        enabled = style.sequenceDiagrams
      pathFilters = filters
    } catch (error) {
      logger.warn(
        `[repo-config] stored diagram setting unavailable repo=${input.repo}: ${describe(error)}`
      )
    }
    try {
      const { fetchPrBase } = gitProviderFor(input)
      const base = await fetchPrBase({
        workspaceId: input.workspaceId,
        fullName: input.repo,
        prNumber: input.prNumber,
      })
      const load = await repoConfigService.loadAt({
        ...gitProviderRefOf(input),
        workspaceId: input.workspaceId,
        repo: input.repo,
        sha: base.sha,
      })
      if (load.status === 'loaded') {
        const fileEnabled = REPO_CONFIG_FIELDS.sequenceDiagrams.read(
          load.config
        )
        if (fileEnabled !== undefined) enabled = fileEnabled
        const fileFilters = REPO_CONFIG_FIELDS.pathFilters.read(load.config)
        if (fileFilters !== undefined) pathFilters = fileFilters
      }
    } catch (error) {
      logger.warn(
        `[repo-config] PR base unavailable for the diagram setting ${input.repo}#${input.prNumber}: ${describe(error)}`
      )
    }
    return { enabled, pathFilters }
  },

  /**
   * The repository's effective review config — every key with its value and
   * source — as of its default branch (or `sha`). For the configuration
   * views. Throws only when the repository's default branch cannot be read.
   */
  async effective(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      sha?: string
    }
  ): Promise<EffectiveRepoConfig> {
    const head = input.sha
      ? { branch: null, sha: input.sha }
      : await gitProviderFor(input).fetchDefaultBranchHead({
          workspaceId: input.workspaceId,
          fullName: input.repo,
        })
    const [load, rows] = await Promise.all([
      repoConfigService.loadAt({
        ...gitProviderRefOf(input),
        workspaceId: input.workspaceId,
        repo: input.repo,
        sha: head.sha,
      }),
      repoReviewSettingRepository.findSettings(
        [input.workspaceId],
        input.repo.toLowerCase()
      ),
    ])
    const row = rows[0]
    const values: RepoReviewSettingValues = { ...DEFAULT_REPO_REVIEW_SETTING }
    if (row)
      for (const key of Object.keys(
        values
      ) as (keyof RepoReviewSettingValues)[])
        if (row[key] !== undefined)
          (values as unknown as Record<string, unknown>)[key] = row[key]
    return {
      config: effectiveReviewConfig(
        { values, stored: row !== undefined },
        load.status === 'loaded' ? load.config : null
      ),
      file: fileStateOf(load, head.sha),
      ref: head.branch,
    }
  },
}
