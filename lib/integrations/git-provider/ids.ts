/**
 * LUM-1315 — the Git host a PullRequest / TaskBranch / ProjectRepository row
 * belongs to. Rows predating the column are GitHub (the column defaults to
 * it). Any reader that hands a row's `repo` to the GitHub API filters on
 * `GITHUB_PROVIDER`: a Codeup path must never be sent to GitHub.
 *
 * LUM-1318: was `GitProvider`; that name is now the port
 * (`./types.ts`) the scan / review layer talks to.
 */
export type GitProviderId = 'github' | 'codeup'

export const GITHUB_PROVIDER = 'github' satisfies GitProviderId
export const CODEUP_PROVIDER = 'codeup' satisfies GitProviderId
