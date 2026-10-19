import { LUMO_HOOK_END, type GitHookSpec } from './git-hook-template'

/**
 * LUM-1258 — the opt-in scan hooks `lumo init --scan-hooks` adds: pre-commit
 * scans the staged changes, pre-push the commits being pushed, both with
 * `lumo security scan --fail-on done`. Exit 3 (a finding the workspace policy
 * would block DONE on) blocks; any other finding is a warning; exit 1 / 2, no
 * `lumo` on PATH, no server context or no network fail open with a line
 * saying so. `git commit|push --no-verify` skips them (git's own rule).
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

// `lumo_report <rc> <what>`: print the scan unless it found nothing, and say
// what the exit code means for the commit / push. Returns 1 only on exit 3.
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
  lumo_out=$(${SCAN} --staged 2>&1)
  if ! lumo_report $? commit; then
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
  while read -r lumo_lref lumo_lsha lumo_rref lumo_rsha; do
    lumo_refs=1
    case $lumo_lsha in *[!0]*) ;; *) continue ;; esac
    case $lumo_lref in refs/tags/*) continue ;; esac
    case $lumo_rsha in
      *[!0]*) git cat-file -e "$lumo_rsha^{commit}" 2>/dev/null || lumo_rsha= ;;
      *) lumo_rsha= ;;
    esac
    if [ -n "$lumo_rsha" ]; then
      lumo_out=$(${SCAN} --since "$lumo_rsha" --until "$lumo_lsha" 2>&1)
    else
      lumo_out=$(${SCAN} --until "$lumo_lsha" 2>&1)
    fi
    lumo_report $? push || lumo_blocked=1
  done
  if [ "$lumo_refs" = 0 ]; then
    if git rev-parse --verify --quiet '@{upstream}' >/dev/null 2>&1; then
      lumo_out=$(${SCAN} --since '@{upstream}' --until HEAD 2>&1)
    else
      lumo_out=$(${SCAN} --until HEAD 2>&1)
    fi
    lumo_report $? push || lumo_blocked=1
  fi
  if [ "$lumo_blocked" = 1 ]; then
    echo "lumo: push blocked — a finding above would block DONE. Fix it, or skip the check once with git push --no-verify." >&2
    exit 1
  fi
else
${NOT_ON_PATH('pre-push')}
fi
${LUMO_HOOK_END}`

export const PRE_COMMIT_SCAN_HOOK: GitHookSpec = {
  hook: 'pre-commit',
  begin: PRE_COMMIT_SCAN_BEGIN,
  block: PRE_COMMIT_SCAN_BLOCK,
  purpose: 'scan staged changes before each commit',
}

export const PRE_PUSH_SCAN_HOOK: GitHookSpec = {
  hook: 'pre-push',
  begin: PRE_PUSH_SCAN_BEGIN,
  block: PRE_PUSH_SCAN_BLOCK,
  purpose: 'scan the commits being pushed',
}

/** The scan hooks, in the order init installs them. */
export const SCAN_HOOKS: readonly GitHookSpec[] = [
  PRE_COMMIT_SCAN_HOOK,
  PRE_PUSH_SCAN_HOOK,
]

/** The scan hook a hook file name belongs to; null for any other file. */
export function scanHookFor(file: string): GitHookSpec | null {
  const name = file.split(/[\\/]/).pop()
  return SCAN_HOOKS.find(h => h.hook === name) ?? null
}
