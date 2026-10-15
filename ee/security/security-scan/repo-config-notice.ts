/**
 * LUM-1146 — what the PR summary says about the repository config file. PURE.
 * Silent when there is nothing to act on (no file, or a file applied
 * cleanly); otherwise one line per problem: an invalid or unreadable base
 * file (the review fell back to the Lumo settings — never silently), keys
 * that were ignored, and a PR that changes the file (checked, applied only
 * once merged).
 */
import { REPO_CONFIG_PATH } from '@/ee/security/validation/repo-config'
import type { RepoConfigFileState, RepoConfigNotice } from './repo-config'

export interface RepoConfigNoticeFormat {
  /** Untrusted text (key names, parser messages) as inert inline code. */
  code: (s: string) => string
}

const FILE = `\`${REPO_CONFIG_PATH}\``

function listOf(items: string[], fmt: RepoConfigNoticeFormat): string {
  return items.map(fmt.code).join('; ')
}

function unknownKeysSentence(
  state: RepoConfigFileState,
  fmt: RepoConfigNoticeFormat
): string | null {
  if (state.unknownKeys.length === 0) return null
  const noun = state.unknownKeys.length === 1 ? 'key' : 'keys'
  return `Unknown ${noun} ignored: ${listOf(state.unknownKeys, fmt)} — check the spelling against the schema.`
}

function baseLines(
  notice: RepoConfigNotice,
  fmt: RepoConfigNoticeFormat
): string[] {
  const { base } = notice
  const where = notice.baseRef
    ? `on the base branch ${fmt.code(notice.baseRef)}`
    : 'on the base branch'
  if (base.status === 'invalid')
    return [
      `- ${FILE} ${where} is invalid and was not applied: this PR was reviewed with the repository's settings in Lumo. Problems: ${listOf(base.problems, fmt)}.`,
    ]
  if (base.status === 'unreadable')
    return [
      `- Lumo could not read ${FILE} ${where} for this review; if the repository has one, this PR was reviewed with the repository's settings in Lumo instead.`,
    ]
  if (base.status === 'loaded') {
    const unknown = unknownKeysSentence(base, fmt)
    return unknown ? [`- ${FILE} ${where}: ${unknown}`] : []
  }
  return []
}

function prBranchLines(
  state: RepoConfigFileState | null,
  fmt: RepoConfigNoticeFormat
): string[] {
  if (!state) return []
  const later =
    'Review settings are read from the base branch, so the change applies to reviews after this PR merges.'
  if (state.status === 'absent')
    return [
      `- This PR deletes ${FILE}. After it merges, reviews use the repository's settings in Lumo.`,
    ]
  if (state.status === 'unreadable')
    return [
      `- This PR changes ${FILE}, but Lumo could not read the new file to check it. ${later}`,
    ]
  if (state.status === 'invalid')
    return [
      `- This PR changes ${FILE} and the new file is invalid: ${listOf(state.problems, fmt)}. ${later} Fix it before merging, or later reviews fall back to the repository's settings in Lumo.`,
    ]
  const unknown = unknownKeysSentence(state, fmt)
  return [`- This PR changes ${FILE}. ${later}${unknown ? ` ${unknown}` : ''}`]
}

/** PURE — the summary's notice lines for the file (empty = say nothing). */
export function formatRepoConfigNotice(
  notice: RepoConfigNotice | null | undefined,
  fmt: RepoConfigNoticeFormat
): string[] {
  if (!notice) return []
  return [...baseLines(notice, fmt), ...prBranchLines(notice.prBranch, fmt)]
}
