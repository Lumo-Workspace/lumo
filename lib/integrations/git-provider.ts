/**
 * LUM-1315 — the Git host a PullRequest / TaskBranch / ProjectRepository row
 * belongs to. Rows predating the column are GitHub (the column defaults to
 * it). Any reader that hands a row's `repo` to the GitHub API filters on
 * `GITHUB_PROVIDER`: a Codeup path must never be sent to GitHub.
 */
export type GitProvider = 'github' | 'codeup'

export const GITHUB_PROVIDER = 'github' satisfies GitProvider
export const CODEUP_PROVIDER = 'codeup' satisfies GitProvider
