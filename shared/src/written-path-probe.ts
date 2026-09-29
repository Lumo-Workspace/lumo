/**
 * LUM-893 / LUM-908 — wire contract for the post-tool-use gitignore probe,
 * shared by the CLI hook (writer) and the boundary detector (reader).
 *
 * `IGNORED_FIELD` carries local git's answer to "is the written file
 * gitignored?". `PROBE_FIELD` = `PROBE_FILE_DIR` says the probe ran in the
 * checkout the written file lives in (LUM-903's fix) — CLI 1.80.0 sent the
 * answer without it, from the session cwd, and got worktree paths wrong.
 */
export const WRITTEN_PATH_IGNORED_FIELD = '_lumo_written_path_ignored'
export const WRITTEN_PATH_PROBE_FIELD = '_lumo_written_path_probe'
export const WRITTEN_PATH_PROBE_FILE_DIR = 'file-dir'

/**
 * LUM-904: the written file's path inside its own checkout
 * (`git rev-parse --show-prefix` beside the file) — the root the server judges
 * the test/fixture/doc path downgrade on, instead of a session cwd that may sit
 * above the checkout.
 */
export const CHECKOUT_RELATIVE_PATH_FIELD = '_lumo_checkout_relative_path'
