#!/usr/bin/env node
// Developer Certificate of Origin check for pull requests (see CONTRIBUTING.md).
//
//   node check-dco.mjs --expected-commits <n> [--pr-author <login> --pr-author-type <type>] < commits.ndjson
//
// Reads the pull request's commits from stdin, one JSON object per line:
//   {"sha": "...", "message": "...", "authorEmail": "...", "parents": 1,
//    "authorLogin": "octocat" | null, "authorType": "User" | "Bot" | null}
// (the DCO workflow builds these lines with `gh api .../pulls/<n>/commits`;
// `authorLogin`/`authorType` are the GitHub account GitHub linked the commit
// to, null when it linked none). `--expected-commits` is the pull request's
// own commit count from the event payload; `--pr-author*` is the account that
// opened the pull request, also from the event payload.
//
// A commit passes when its message carries a `Signed-off-by: Name <email>`
// trailer whose email is the commit author's (compared case-insensitively).
// Merge commits (more than one parent) are skipped.
//
// Bot exemption. A bot cannot certify the DCO, so commits by an allowlisted
// GitHub App bot (BOT_ALLOWLIST) are exempt — but never on git metadata: the
// author email (`…[bot]@users.noreply.github.com`) is free text anyone can
// write. A commit is exempt only when BOTH
//   - the pull request was opened by that bot account (`--pr-author`, type
//     `Bot`) — only the App itself can open a pull request as its bot user; and
//   - GitHub linked the commit to that same bot account (`authorLogin`,
//     `authorType: Bot`).
// GitHub links a commit to an account by its author email, so the second
// check alone could be forged; the first cannot. A commit GitHub linked to no
// account always needs a sign-off.
//
// Incomplete lists fail. GitHub's pull request commits API returns at most 250
// commits; when stdin holds fewer commits than `--expected-commits`, the check
// fails rather than pass a partly checked pull request.
//
// Exit 0 when every commit passes, 1 when any fails or the list is incomplete,
// 2 on unreadable input or usage. Only node built-ins: the workflow runs it
// without installing dependencies.

import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SIGN_OFF_RE = /^Signed-off-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/gm

/** GitHub App bot accounts whose commits need no sign-off. */
export const BOT_ALLOWLIST = new Set([
  'dependabot[bot]',
  'github-actions[bot]',
  'renovate[bot]',
])

/** The most commits GitHub's pull request commits API lists. */
export const API_COMMIT_LIMIT = 250

/** The emails of every `Signed-off-by:` trailer in a commit message. */
export function signOffEmails(message) {
  return [...String(message ?? '').matchAll(SIGN_OFF_RE)].map(m =>
    m[2].toLowerCase()
  )
}

/** An allowlisted GitHub App bot account (login and account type both). */
export function isAllowlistedBot(login, type) {
  const l = String(login ?? '')
  return type === 'Bot' && l.endsWith('[bot]') && BOT_ALLOWLIST.has(l)
}

/**
 * Whether a commit is exempt as a bot's: the pull request was opened by an
 * allowlisted bot and GitHub linked the commit to that same account. The
 * author email plays no part.
 */
export function isBotCommit(commit, prAuthor) {
  if (!prAuthor || !isAllowlistedBot(prAuthor.login, prAuthor.type))
    return false
  return (
    isAllowlistedBot(commit.authorLogin, commit.authorType) &&
    commit.authorLogin === prAuthor.login
  )
}

/** Why a commit fails the DCO check, or null when it passes or is exempt. */
export function dcoProblem(commit, prAuthor = null) {
  if ((commit.parents ?? 1) > 1) return null
  if (isBotCommit(commit, prAuthor)) return null
  const author = String(commit.authorEmail ?? '').toLowerCase()
  const emails = signOffEmails(commit.message)
  if (emails.length === 0) return 'no Signed-off-by trailer'
  if (!author || !emails.includes(author))
    return `no Signed-off-by trailer matches the author email <${commit.authorEmail ?? ''}>`
  return null
}

/**
 * Why the commit list cannot be judged as a whole (it is shorter than the pull
 * request), or null.
 */
export function coverageProblem(listed, expected) {
  if (listed >= expected) return null
  return expected > API_COMMIT_LIMIT
    ? `this pull request has ${expected} commits; GitHub lists at most ${API_COMMIT_LIMIT}, so the sign-offs cannot all be checked. Squash or split it into pull requests of at most ${API_COMMIT_LIMIT} commits.`
    : `only ${listed} of the pull request's ${expected} commits were listed; re-run the check.`
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (value === undefined) return null
    if (flag === '--expected-commits') args.expected = value
    else if (flag === '--pr-author') args.prAuthorLogin = value
    else if (flag === '--pr-author-type') args.prAuthorType = value
    else return null
  }
  const expected = Number(args.expected)
  if (!Number.isInteger(expected) || expected < 1) return null
  return {
    expected,
    prAuthor: args.prAuthorLogin
      ? { login: args.prAuthorLogin, type: args.prAuthorType ?? '' }
      : null,
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    process.stderr.write(
      'usage: check-dco.mjs --expected-commits <n> [--pr-author <login> --pr-author-type <type>] < commits.ndjson\n'
    )
    process.exit(2)
  }
  let lines
  try {
    lines = readFileSync(0, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .map(l => JSON.parse(l))
  } catch {
    process.stderr.write('check-dco: stdin is not one JSON object per line\n')
    process.exit(2)
  }
  if (lines.length === 0) {
    process.stderr.write('check-dco: no commits on stdin\n')
    process.exit(2)
  }
  const coverage = coverageProblem(lines.length, args.expected)
  if (coverage) {
    process.stdout.write(`✗ ${coverage}\n`)
    process.exit(1)
  }
  const failures = lines
    .map(c => ({
      sha: String(c.sha ?? '').slice(0, 12),
      problem: dcoProblem(c, args.prAuthor),
    }))
    .filter(f => f.problem)
  for (const f of failures) process.stdout.write(`✗ ${f.sha}: ${f.problem}\n`)
  if (failures.length > 0) {
    process.stdout.write(
      [
        '',
        `${failures.length} of ${lines.length} commit(s) are not signed off.`,
        'Sign off with `git commit -s` (the trailer must use your commit email). To fix',
        'existing commits: `git rebase --signoff origin/main` and force-push your branch.',
        'See CONTRIBUTING.md for what the sign-off certifies.',
        '',
      ].join('\n')
    )
    process.exit(1)
  }
  process.stdout.write(`✓ all ${lines.length} commit(s) signed off\n`)
}

// Run only as a script, so tests can import the functions.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  main()
