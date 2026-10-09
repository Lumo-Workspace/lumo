// Idempotent install + content management for the Lumo `prepare-commit-msg`
// git hook. The hook block itself is pure POSIX sh + git — it extracts the
// `LUM-N` tag from the current branch name and appends it to the commit
// subject, with NO dependency on the `lumo` binary or any network call.

/** Markers delimiting the Lumo-managed block inside a prepare-commit-msg file. */
export const LUMO_HOOK_BEGIN = '# >>> lumo prepare-commit-msg >>>'
export const LUMO_HOOK_END = '# <<< lumo <<<'

const SHEBANG = '#!/bin/sh'

// The managed block. `$1` = commit-message file, `$2` = message source
// (message|template|merge|squash|commit). awk is POSIX-required and present
// wherever git runs. The grep guard makes the hook a no-op when the message
// already carries any [LUM-x] tag.
export const HOOK_SCRIPT_BLOCK = `${LUMO_HOOK_BEGIN}
# Auto-append the branch's task ID ([LUM-N]) to the commit subject when absent.
# Managed by \`lumo init\` — edit between the markers at your own risk.
case "$2" in
  merge|squash) exit 0 ;;
esac
lumo_branch=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
lumo_id=$(printf '%s' "$lumo_branch" | grep -oE 'LUM-[0-9]+' | head -n1)
[ -z "$lumo_id" ] && exit 0
# Skip if the message already references any [LUM-x] anywhere (subject OR body)
# — avoids double-tagging when a body line already cites the task.
grep -qE '\\[LUM-[0-9]+\\]' "$1" && exit 0
lumo_tmp="$1.lumo.tmp"
awk -v id="$lumo_id" '
  !done && $0 !~ /^#/ && $0 !~ /^[[:space:]]*$/ { $0 = $0 " [" id "]"; done = 1 }
  { print }
' "$1" > "$lumo_tmp" && mv "$lumo_tmp" "$1"
${LUMO_HOOK_END}`

export type MergeGitHookStatus =
  | 'created'
  | 'updated'
  | 'unchanged'
  | 'appended'

/**
 * Idempotently fold the Lumo block into an existing prepare-commit-msg file.
 * - null/blank existing      → fresh file with shebang + block ('created')
 * - existing has our markers  → replace block in place ('updated' / 'unchanged')
 * - existing foreign content  → preserve it, append our block ('appended')
 */
export function mergeGitHook(existing: string | null): {
  content: string
  status: MergeGitHookStatus
} {
  if (existing === null || existing.trim() === '') {
    return { content: `${SHEBANG}\n${HOOK_SCRIPT_BLOCK}\n`, status: 'created' }
  }

  const beginIdx = existing.indexOf(LUMO_HOOK_BEGIN)
  if (beginIdx !== -1) {
    const endIdx = existing.indexOf(LUMO_HOOK_END, beginIdx)
    if (endIdx !== -1) {
      const before = existing.slice(0, beginIdx)
      const after = existing.slice(endIdx + LUMO_HOOK_END.length)
      const content = before + HOOK_SCRIPT_BLOCK + after
      return {
        content,
        status: content === existing ? 'unchanged' : 'updated',
      }
    }
    // BEGIN without END: corrupt block — fall through and append a clean one.
  }

  const sep = existing.endsWith('\n') ? '\n' : '\n\n'
  return {
    content: `${existing}${sep}${HOOK_SCRIPT_BLOCK}\n`,
    status: 'appended',
  }
}

/**
 * Decide whether `lumo init` can write the hook directly. When
 * `core.hooksPath` is set (husky or a custom dir), writing into it risks being
 * clobbered or landing where git won't run it — so we degrade to instructions.
 */
export function resolveHookInstall(
  coreHooksPath: string | null
): { mode: 'install' } | { mode: 'degrade' } {
  if (coreHooksPath && coreHooksPath.trim() !== '') return { mode: 'degrade' }
  return { mode: 'install' }
}
