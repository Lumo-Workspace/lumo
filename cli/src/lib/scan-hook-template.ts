import { LUMO_HOOK_END, type GitHookSpec } from './git-hook-template'

/**
 * LUM-1258 — the opt-in scan hooks `lumo init --scan-hooks` adds: pre-commit
 * scans the staged changes, pre-push the commits being pushed, both with
 * `lumo security scan --fail-on done`. Exit 3 (a finding the workspace policy
 * would block DONE on) blocks; any other finding is a warning; exit 1 / 2, no
 * `lumo` on PATH, no server context or no network fail open with a line
 * saying so. `git commit|push --no-verify` skips them (git's own rule).
 *
 * LUM-1259: with `--scan-log` too (git config `lumo.scanLog`), post-commit
 * and pre-push also record each commit's local scan on the Lumo server, in
 * the background — never waited on, never failing the commit or push.
 *
 * Appended as managed blocks like prepare-commit-msg's, so an existing hook
 * keeps running first. A block never `exit 0`s: it falls through to whatever
 * follows it, and exits 1 only to block.
 */

/** Seconds a hook waits for the Lumo server before the cached context. */
export const SCAN_HOOK_TIMEOUT_SECONDS = 2

const SCAN = `lumo security scan --fail-on done --timeout ${SCAN_HOOK_TIMEOUT_SECONDS}`

export const PRE_COMMIT_SCAN_BEGIN = '# >>> lumo pre-commit >>>'
export const PRE_PUSH_SCAN_BEGIN = '# >>> lumo pre-push >>>'
export const POST_COMMIT_LOG_BEGIN = '# >>> lumo post-commit >>>'

/**
 * LUM-1259 — the repo-local git config switch of the local scan log, set by
 * `lumo init --scan-hooks --scan-log` (`git config lumo.scanLog false` turns
 * it off). With it on, post-commit records each new commit and pre-push each
 * commit being pushed: `lumo security scan --log` in the background, output
 * discarded, so the commit / push never waits on it or fails because of it.
 */
export const SCAN_LOG_CONFIG = 'lumo.scanLog'

// `lumo_log_bg <args>`: one `lumo security scan --log` run, detached from the
// hook (stdin, stdout and stderr closed) so git does not wait for it.
// LUMO_SCAN_LOG_FOREGROUND=1 runs it in the foreground (tests, debugging).
// Neither form can fail the hook, even under `set -e`.
const LOG_FN = `lumo_log_bg() {
  if [ "\${LUMO_SCAN_LOG_FOREGROUND:-}" = 1 ]; then
    lumo security scan "$@" --log </dev/null >/dev/null 2>&1 || :
  else
    (lumo security scan "$@" --log </dev/null >/dev/null 2>&1 &)
  fi
  return 0
}`

const LOG_ON = `[ "$(git config --bool ${SCAN_LOG_CONFIG} 2>/dev/null)" = true ]`

// `lumo_report <rc> <what>`: print the scan unless it found nothing, and say
// what the exit code means for the commit / push. Returns 1 only on exit 3.
// Every scan's exit code is read as `lumo_out=$(…) || lumo_rc=$?`: the left
// side of `||` is exempt from `set -e`, so a hook that sets it before this
// block still fails open on exit 1 / 2 and still reports an exit 3.
const REPORT_FN = `lumo_report() {
  case $1 in
    0)
      if ! printf '%s\\n' "$lumo_out" | grep -q '^scan: 0 findings'; then
        printf '%s\\n' "$lumo_out" >&2
        echo "lumo: warning only — not blocking the $2." >&2
      fi
      return 0 ;;
    3)
      printf '%s\\n' "$lumo_out" >&2
      return 1 ;;
    *)
      printf '%s\\n' "$lumo_out" >&2
      echo "lumo: security scan could not run (exit $1) — not blocking the $2." >&2
      return 0 ;;
  esac
}`

const HEADER = (
  what: string,
  skip: string
) => `# Lumo security scan of ${what} (opted in with \`lumo init --scan-hooks\`).
# Blocks only on a finding the workspace policy would block DONE on; anything
# else is a warning. Skip it once with \`${skip} --no-verify\`.
# Managed by \`lumo init\` — edit between the markers at your own risk.`

const NOT_ON_PATH = (hook: string) =>
  `  echo "lumo: not on PATH — ${hook} security scan skipped (npm install -g @lumoai/cli)." >&2`

export const PRE_COMMIT_SCAN_BLOCK = `${PRE_COMMIT_SCAN_BEGIN}
${HEADER('the staged changes', 'git commit')}
if command -v lumo >/dev/null 2>&1; then
${REPORT_FN.replace(/^/gm, '  ')}
  lumo_rc=0
  lumo_out=$(${SCAN} --staged 2>&1) || lumo_rc=$?
  if ! lumo_report "$lumo_rc" commit; then
    echo "lumo: commit blocked — a finding above would block DONE. Fix it, or skip the check once with git commit --no-verify." >&2
    exit 1
  fi
else
${NOT_ON_PATH('pre-commit')}
fi
${LUMO_HOOK_END}`

// stdin: `<local ref> <local sha> <remote ref> <remote sha>` per pushed ref.
// A deletion (local sha all zeros) and tags are skipped. The range starts at
// the remote's sha when this clone has it, else (a new branch, or a
// force-push over commits not fetched) at the merge-base with the default
// branch. No stdin (an earlier part of the hook read it): the upstream, else
// the merge-base, up to HEAD.
export const PRE_PUSH_SCAN_BLOCK = `${PRE_PUSH_SCAN_BEGIN}
${HEADER('the commits being pushed', 'git push')}
if command -v lumo >/dev/null 2>&1; then
${REPORT_FN.replace(/^/gm, '  ')}
  lumo_blocked=0
  lumo_refs=0
  lumo_log=0
  if ${LOG_ON}; then
${LOG_FN.replace(/^/gm, '    ')}
    lumo_log=1
  fi
  while read -r lumo_lref lumo_lsha lumo_rref lumo_rsha; do
    lumo_refs=1
    case $lumo_lsha in *[!0]*) ;; *) continue ;; esac
    case $lumo_lref in refs/tags/*) continue ;; esac
    case $lumo_rsha in
      *[!0]*) git cat-file -e "$lumo_rsha^{commit}" 2>/dev/null || lumo_rsha= ;;
      *) lumo_rsha= ;;
    esac
    lumo_rc=0
    if [ -n "$lumo_rsha" ]; then
      lumo_out=$(${SCAN} --since "$lumo_rsha" --until "$lumo_lsha" 2>&1) || lumo_rc=$?
    else
      lumo_out=$(${SCAN} --until "$lumo_lsha" 2>&1) || lumo_rc=$?
    fi
    lumo_report "$lumo_rc" push || lumo_blocked=1
    if [ "$lumo_log" = 1 ]; then
      if [ -n "$lumo_rsha" ]; then
        lumo_log_bg --since "$lumo_rsha" --until "$lumo_lsha" --hook pre-push
      else
        lumo_log_bg --until "$lumo_lsha" --hook pre-push
      fi
    fi
  done
  if [ "$lumo_refs" = 0 ]; then
    lumo_rc=0
    if git rev-parse --verify --quiet '@{upstream}' >/dev/null 2>&1; then
      lumo_out=$(${SCAN} --since '@{upstream}' --until HEAD 2>&1) || lumo_rc=$?
      if [ "$lumo_log" = 1 ]; then
        lumo_log_bg --since '@{upstream}' --until HEAD --hook pre-push
      fi
    else
      lumo_out=$(${SCAN} --until HEAD 2>&1) || lumo_rc=$?
      if [ "$lumo_log" = 1 ]; then
        lumo_log_bg --until HEAD --hook pre-push
      fi
    fi
    lumo_report "$lumo_rc" push || lumo_blocked=1
  fi
  if [ "$lumo_blocked" = 1 ]; then
    echo "lumo: push blocked — a finding above would block DONE. Fix it, or skip the check once with git push --no-verify." >&2
    exit 1
  fi
else
${NOT_ON_PATH('pre-push')}
fi
${LUMO_HOOK_END}`

// LUM-1259: post-commit has the real sha (pre-commit has none yet). The sha
// is read here, not in the background run, so a quick next commit cannot
// change which commit gets recorded.
export const POST_COMMIT_LOG_BLOCK = `${POST_COMMIT_LOG_BEGIN}
# Lumo local scan log (opted in with \`lumo init --scan-hooks --scan-log\`):
# records this commit's local scan result on the Lumo server, in the
# background. Never blocks or fails a commit; offline, the result is queued
# under .git/lumo and sent later. Off: \`git config ${SCAN_LOG_CONFIG} false\`.
# Managed by \`lumo init\` — edit between the markers at your own risk.
if ${LOG_ON} && command -v lumo >/dev/null 2>&1; then
${LOG_FN.replace(/^/gm, '  ')}
  if lumo_sha=$(git rev-parse --verify --quiet HEAD); then
    lumo_log_bg --commit "$lumo_sha" --hook post-commit
  fi
fi
${LUMO_HOOK_END}`

export const PRE_COMMIT_SCAN_HOOK: GitHookSpec = {
  hook: 'pre-commit',
  begin: PRE_COMMIT_SCAN_BEGIN,
  block: PRE_COMMIT_SCAN_BLOCK,
  purpose: 'scan staged changes before each commit',
  initFlags: '--scan-hooks',
}

export const PRE_PUSH_SCAN_HOOK: GitHookSpec = {
  hook: 'pre-push',
  begin: PRE_PUSH_SCAN_BEGIN,
  block: PRE_PUSH_SCAN_BLOCK,
  purpose: 'scan the commits being pushed',
  initFlags: '--scan-hooks',
}

/** LUM-1259 — records each commit's local scan on the server (opt-in). */
export const POST_COMMIT_LOG_HOOK: GitHookSpec = {
  hook: 'post-commit',
  begin: POST_COMMIT_LOG_BEGIN,
  block: POST_COMMIT_LOG_BLOCK,
  purpose: "record each commit's local scan result on the Lumo server",
  initFlags: '--scan-hooks --scan-log',
}

/** The scan hooks, in the order init installs them. */
export const SCAN_HOOKS: readonly GitHookSpec[] = [
  PRE_COMMIT_SCAN_HOOK,
  PRE_PUSH_SCAN_HOOK,
]

/** LUM-1259 — the hooks `--scan-log` adds on top of {@link SCAN_HOOKS}. */
export const SCAN_LOG_HOOKS: readonly GitHookSpec[] = [POST_COMMIT_LOG_HOOK]

/** The scan hook a hook file name belongs to; null for any other file. */
export function scanHookFor(file: string): GitHookSpec | null {
  const name = file.split(/[\\/]/).pop()
  return [...SCAN_HOOKS, ...SCAN_LOG_HOOKS].find(h => h.hook === name) ?? null
}
