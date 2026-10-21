/**
 * Which invocations may run the update notice and the background
 * refresh / auto-update worker before the command itself.
 */

/**
 * LUM-1292: `lumo skill read` is a pure local read of package files — no
 * login, no network, no writes under ~/.lumo — so the update check and the
 * background worker never run before it.
 */
export function isSkillRead(argv: readonly string[]): boolean {
  return argv[2] === 'skill' && argv[3] === 'read'
}

/**
 * LUM-1113: `lumo init --dry-run` promises zero writes, so the update check /
 * background auto-update may not run before it.
 */
export function isInitDryRun(argv: readonly string[]): boolean {
  return argv[2] === 'init' && argv.slice(3).includes('--dry-run')
}

/**
 * Whether the update notice and the background refresh/auto-update worker may
 * run. Not for `uninstall` (the worker could reinstall the CLI right after
 * `npm rm -g`, or recreate ~/.lumo after `--purge`), an init dry run, or
 * `skill read`.
 */
export function shouldCheckForUpdates(argv: readonly string[]): boolean {
  return argv[2] !== 'uninstall' && !isInitDryRun(argv) && !isSkillRead(argv)
}
