import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve the local Claude Code memory directory for a project working dir.
 * Claude Code stores per-project memory under
 * `~/.claude/projects/<encoded-cwd>/memory/`, where the cwd is encoded by
 * replacing path separators with `-` (e.g. `/Users/x/lumo` →
 * `-Users-x-lumo`). The encoding lives ONLY here so a Claude Code change is a
 * one-line fix; `lumo memory sync --dry-run` prints the resolved path so the
 * dev can sanity-check it, and `--dir` overrides entirely.
 */
export function resolveMemoryDir(
  cwd: string,
  home: string = homedir(),
  override?: string
): string {
  if (override) return override
  const encoded = cwd.replace(/\//g, '-')
  return join(home, '.claude', 'projects', encoded, 'memory')
}
