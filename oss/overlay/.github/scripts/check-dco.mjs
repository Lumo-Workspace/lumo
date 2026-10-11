#!/usr/bin/env node
// Developer Certificate of Origin check for pull requests (see CONTRIBUTING.md).
//
// Reads the pull request's commits from stdin, one JSON object per line:
//   {"sha": "...", "message": "...", "authorName": "...", "authorEmail": "...", "parents": 1}
// (the DCO workflow builds these lines with `gh api .../pulls/<n>/commits`).
//
// A commit passes when its message carries a `Signed-off-by: Name <email>`
// trailer whose email is the commit author's (compared case-insensitively).
// Merge commits (more than one parent) are skipped, and so are commits authored
// by GitHub bot accounts (`…[bot]@users.noreply.github.com`, e.g. Dependabot):
// a bot cannot certify the DCO, and a maintainer reviews those pull requests.
//
// Exit 0 when every commit passes, 1 when any fails, 2 on unreadable input.
// Only node built-ins: the workflow runs it without installing dependencies.

import { readFileSync, realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const SIGN_OFF_RE = /^Signed-off-by:\s*(.+?)\s*<([^<>\s]+)>\s*$/gm
const BOT_EMAIL_RE = /\[bot\]@users\.noreply\.github\.com$/i

/** The emails of every `Signed-off-by:` trailer in a commit message. */
export function signOffEmails(message) {
  return [...String(message ?? '').matchAll(SIGN_OFF_RE)].map(m =>
    m[2].toLowerCase()
  )
}

/** Why a commit fails the DCO check, or null when it passes or is exempt. */
export function dcoProblem(commit) {
  if ((commit.parents ?? 1) > 1) return null
  const author = String(commit.authorEmail ?? '').toLowerCase()
  if (BOT_EMAIL_RE.test(author)) return null
  const emails = signOffEmails(commit.message)
  if (emails.length === 0) return 'no Signed-off-by trailer'
  if (!author || !emails.includes(author))
    return `no Signed-off-by trailer matches the author email <${commit.authorEmail ?? ''}>`
  return null
}

function main() {
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
  const failures = lines
    .map(c => ({
      sha: String(c.sha ?? '').slice(0, 12),
      problem: dcoProblem(c),
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
