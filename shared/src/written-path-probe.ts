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
