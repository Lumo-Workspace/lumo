# LUM-141 — `task artifact add --file` path guard

**Date:** 2026-06-01
**Task:** LUM-141 — CLI: `task artifact add --file` 可被 agent 诱导读取并上传任意本地文件
**Milestone:** CLI Security Hardening

## Problem

`cli/src/commands/task-artifact-add.ts` reads the user-supplied `--file` path
via `readFileUtf8(options.file)` and POSTs its contents to the server. Run by a
human this is harmless. But this command is documented in `SKILL.md` and is
**agent-invokable** — a prompt-injected agent could be induced to run
`lumo task artifact add LUM-1 --file ~/.ssh/id_rsa` (or `.env`) and exfiltrate
secrets to the workspace.

Severity: low (requires a successful prompt injection), but it is a real
file-exfiltration primitive that should be closed in code, not just in docs.

## Goal

Add **code-level** enforcement (not docs-only) so that `task artifact add
--file` refuses to read:

1. **paths outside the project directory** (`process.cwd()`), and
2. **sensitive files even inside the project directory** (e.g. `.env`,
   private keys, credential files).

A blocked read fails before any network request. No override flag — a tricked
agent must not be able to bypass it, and a human with a legitimate need can copy
the file into the project. SKILL.md is updated to document the constraint.

## Non-goals

- `doc create --file` / `doc update --file` share the same read pattern but are
  **out of scope** for LUM-141 (sibling tasks under the same milestone). A
  `spawn_task` note will flag them after this lands.
- No new dependency. No change to the server API or payload shape.

## Architecture

A single-purpose, pure, dependency-injected guard module:
`cli/src/lib/path-guard.ts`.

```ts
export interface PathGuardDeps {
  cwd: () => string
  realpath: (p: string) => string // realpathSync semantics; throws if missing
}

export type PathGuardResult =
  | { ok: true; resolved: string }
  | { ok: false; reason: 'sensitive'; detail: string }
  | { ok: false; reason: 'outside-project'; detail: string }
  | { ok: false; reason: 'unreadable'; detail: string }

export function checkArtifactFilePath(
  rawPath: string,
  deps?: Partial<PathGuardDeps>
): PathGuardResult
```

`deps` defaults to `{ cwd: process.cwd, realpath: fs.realpathSync }`. Tests
inject fakes so no real filesystem is touched.

Internal helpers:

- `matchSensitiveName(p: string): string | null` — pure string check; returns a
  human-readable reason (e.g. `"matches .env"`) or `null`.
- confinement check — `realpath(path.resolve(cwd, rawPath))` must equal `cwd`
  or start with `cwd + path.sep`.

### Evaluation order (inside `checkArtifactFilePath`)

1. **Sensitive name (raw)** — fail-fast denylist on the raw path, no fs access.
   → `sensitive`.
2. **Resolve realpath** of `path.resolve(cwd, rawPath)`. If it throws
   (ENOENT/EACCES) → `unreadable`.
3. **Sensitive name (canonical)** — re-run denylist on the realpath basename /
   segments, to catch a symlink whose name looks innocent but resolves to a
   secret. → `sensitive`.
4. **Confinement** — realpath must be inside `cwd`. → `outside-project`.
5. Otherwise → `{ ok: true, resolved: <realpath> }`.

`realpath` in step 2 also defeats symlinks that escape the project: a
project-local `notes.md` symlinked to `~/.ssh/id_rsa` resolves outside `cwd` and
is rejected by step 4.

## Denylist

Matched against the basename and path segments (case-insensitive on basename
globs):

- **Basename exact / glob:** `.env`, `.env.*` (`.env.local`, `.env.production`,
  …), `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.pem`, `*.key`, `*.pfx`,
  `*.p12`, `credentials`, `.npmrc`, `.netrc`, `.pgpass`, `.htpasswd`
- **Path segment contains:** `.ssh`, `.aws`, `.gnupg`

Covers both examples named in the task: `~/.ssh/id_rsa` (caught by confinement +
`id_rsa` + `.ssh`) and `.env` (caught by the denylist).

## Command integration

In `task-artifact-add.ts`, replace the existing read block. The guard runs in
the same pre-network validation layer as the `--kind` / `--source` / `--agent`
checks:

```ts
const verdict = checkArtifactFilePath(options.file)
if (!verdict.ok) {
  if (verdict.reason === 'unreadable') {
    console.error(`Error: could not read file ${options.file}`) // unchanged UX
  } else {
    console.error(
      `Error: refusing to read ${options.file} — ${verdict.detail}. ` +
        `artifact --file must be a non-sensitive path inside the project directory.`
    )
  }
  return 1
}
content = await readFileUtf8(verdict.resolved) // read the canonical path
```

- Security rejection happens **before** any `fetch`.
- Exit code stays `1`.
- The empty-file check (`content.trim().length === 0`) is unchanged and runs
  after the guard.

## Error handling

| Condition                          | reason            | stderr message                                    | exit |
| ---------------------------------- | ----------------- | ------------------------------------------------- | ---- |
| `.env`, `id_rsa`, `*.pem`, …       | `sensitive`       | `refusing to read … — matches <pattern>. …`       | 1    |
| `../x`, `/abs/outside`, escaped ln | `outside-project` | `refusing to read … — resolves outside project. …`| 1    |
| missing / unreadable path          | `unreadable`      | `could not read file <path>` (existing message)   | 1    |

## Testing

New `__tests__/cli/path-guard.test.ts` (pure; injects fake `cwd` / `realpath`,
no real fs):

- `docs/spec.md` inside cwd → `ok`, `resolved` is the realpath.
- `../../etc/passwd` and absolute `/Users/x/.ssh/id_rsa` → `outside-project`.
- symlink case: fake `realpath` returns a path outside cwd → `outside-project`.
- cwd-internal `.env`, `.env.local`, `id_rsa`, `server.pem`, `.aws/credentials`
  → `sensitive`.
- fake `realpath` throws ENOENT → `unreadable`.

Extend `__tests__/cli/task-artifact-add.test.ts`:

- `--file ../../secret.env` → returns `1`, `fetch` **not** called.
- existing happy-path still POSTs (guard mocked / path treated as ok).

## Documentation

Update the `artifact add` subsection of `.claude/skills/lumo/SKILL.md`: state
that `--file` must be a non-sensitive path **inside the project directory**, and
that the CLI enforces this (rejecting traversal / absolute / sensitive paths)
with no override. Required by the CLAUDE.md rule that CLI behavior changes sync
to SKILL.md.

## Risks / trade-offs

- **`process.cwd()` as project root** (vs git root): chosen for simplicity and
  because it matches the agent's actual working directory; no `git` spawn
  needed. A user who runs the CLI from outside their repo would need to `cd` in
  — acceptable.
- **No override flag**: deliberately. An override would be includable in an
  injected prompt and would weaken the guarantee. Legitimate out-of-tree files
  can be copied into the project.
- **Denylist completeness**: a denylist can never be exhaustive, but it is the
  second layer behind confinement; the primary guarantee is "inside the project
  directory", and the denylist closes the in-project secret case (`.env`).
