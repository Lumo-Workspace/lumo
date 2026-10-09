# Onboarding, Authentication & Self-Update

## Onboarding

### `lumo init [--user|--project] [--force] [--agent <token>] [--upgrade]` — install skill + hooks (alias: `lumo setup`)

Bootstraps Lumo into a coding-agent installation. Copies the bundled skill files (`SKILL.md` **and its `references/` directory**) into `<scope>/.claude/skills/lumo/` and idempotently merges 25 hook entries into `<scope>/.claude/settings.json`. Existing user permissions and non-Lumo hook entries are preserved.

**`--agent codex`** installs for Codex instead: the same skill files go to `<scope>/.agents/skills/lumo/` (Codex loads skills from there in the CLI, desktop app and IDE extension), and **no hooks are written** — Lumo has no Codex hook adapter yet, so session binding (`session attach/status`) and activity capture stay Claude Code only. Nothing under `.claude/` is touched. The `--project` git hook below is installed as usual. The npm package root is also a portable Agent Plugins package (`plugin.json` + `skills/lumo/`), so a Codex / ChatGPT plugin marketplace can list `@lumoai/cli` as an `npm` source.

On `--project` scope, setup also installs a `prepare-commit-msg` git hook that
auto-appends the branch's task ID (`[LUM-N]`, parsed from a `lumo/LUM-N-...`
branch name) to any commit subject that lacks it. The hook is pure sh + git
(no network, no `lumo` call) and is merged idempotently between
`# >>> lumo prepare-commit-msg >>>` / `# <<< lumo <<<` markers, preserving any
existing hook content. When `core.hooksPath` is set (husky or a custom hooks
dir), setup does **not** write the file — it prints the block plus instructions
to add it manually (e.g. to `.husky/prepare-commit-msg`). `--user` scope does
not touch git hooks.

When logged in, setup ends with one `ℹ Session records in this workspace: …` line — the workspace's current session record mode and retention, and that an OWNER can change it in Settings → Data retention (link included). Not logged in, offline, or an older server → the line is skipped silently; setup never fails on it.

For every other agent, `--agent <token>` records which coding agent these hooks run under and is **baked into every hook command** (`lumo hook <slug> --agent <token>`). Each hook then sends the agent to the server, where it's stored on the Session and inherited by auto-sedimented memories — so a memory is attributed to the agent that produced it instead of the default. Valid tokens: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases). **Defaults to `claude-code`.** Re-running setup with a different `--agent` rewrites the token in place (no duplicate hook entries), and a legacy flagless entry is upgraded on the next run.

```bash
npx @lumoai/cli init                     # interactive: prompts user/project; agent=claude-code
npx @lumoai/cli init  --user             # write to ~/.claude/
npx @lumoai/cli init  --project          # write to ./.claude/
lumo init --project --force             # same via global install: overwrite skill files if they differ from bundled
lumo init --upgrade                     # refresh all known installs: skills (managed+older only; modified/newer skipped, never downgrades), Claude settings hooks, and the Lumo prepare-commit-msg block (default hooks dir / recorded paths)
lumo init --project --agent codex       # Codex: skill into ./.agents/skills/lumo/, no hooks
lumo setup --project                    # legacy hidden alias of `lumo init`
lumo init --project --agent cursor      # bake agent=cursor into the hook commands
```

#### When to suggest

- The user asks "how do I set up lumo", "install the lumo skill", "wire up lumo hooks"
- A fresh checkout of a project that uses Lumo doesn't have `.claude/skills/lumo/SKILL.md` (or, for Codex, `.agents/skills/lumo/SKILL.md`) yet
- The user works in Codex — `lumo init --agent codex` (add `--user` for every repo)
- After `npm install -g @lumoai/cli`, before the first `lumo auth login`
- Wiring Lumo hooks into another agent (Cursor / …) — pass `--agent <token>` so its memories are attributed correctly

If stdin is not a TTY (CI, piped invocation), the default scope is `project` and no prompt is shown. An unrecognized `--agent` token aborts before writing anything.

### `lumo doctor [--json]` — inspect every Lumo install (read-only)

Lists what Lumo installed on this machine and in the current repo, grouped as `This machine` (user-scope paths, the default `.git/hooks`), `This repo — committed` (git-tracked, incl. a tracked `core.hooksPath` dir), `This repo — uncommitted` and `Other repos` (recorded project installs outside the current repo). Sources: the install registry (skills, Claude settings and git hooks; stale paths warn), the known skill locations, `~/.claude/settings.json` and `<repo>/.claude/settings.json` Lumo hook entries, the `prepare-commit-msg` block (honours `core.hooksPath`) and `~/.codex/hooks.json` `lumo hook` entries. Each row shows path, kind, version, state and a fix command:

| State            | Meaning                                                 | Suggested command                                                      |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| `up to date`     | matches this CLI                                        | none                                                                   |
| `behind <v>`     | managed copy older than the CLI (git hook: stale block) | `lumo init --upgrade`                                                  |
| `modified`       | edited locally                                          | `lumo init --force` (discards the edits — only if the user wants that) |
| `newer than CLI` | installed by a newer CLI                                | `lumo update`                                                          |
| `incomplete`     | Claude settings missing hook events                     | `lumo init --user` / `--project`                                       |

Warnings (never change the exit code, which is always 0): missing Lumo hook events vs the canonical list, `lumo` not resolvable on PATH, user and project skill of one agent at different versions, an unreadable registry (reported, never rewritten), registry entries whose path is gone, and Codex hooks not trusted. Codex trust is a text scan of `~/.codex/config.toml` for a `[hooks.state."<hooks.json>:<event_snake>:…"]` section with a `trusted_hash`; the hash is not verified (shown as `trusted (hash not verified)`), and a missing entry means open `/hooks` in Codex and Trust. `--json` prints `{ cliVersion, rows, warnings }`.

```bash
lumo doctor
lumo doctor --json
```

#### When to suggest

- The user asks whether Lumo is installed correctly, why hooks do not fire, or which copies are outdated
- Before `lumo init --upgrade` or `--force`, to preview what would change

## Authentication

### `lumo auth login` — paste an API key to log in

Walks the user through creating an API key in the web app and pasting it back. Opens the browser to the API Keys settings page, then reads the key from stdin (must start with the `lum_` prefix). On success prints `✓ Logged in as <email>` plus workspace + key name.

```bash
lumo auth login
```

#### When to suggest

- A command reports `not logged in`, or an auth failure (`API key invalid or revoked` / the `Hint: … HTTP 401 … lumo auth login` line)
- The user switches workspaces / accounts

The CLI stores credentials in `~/.lumo/credentials.json`. There's no `--token` flag — the paste-from-browser flow is the only auth path, and that's intentional.

### `lumo auth logout` — remove local credentials

Wipes `~/.lumo/credentials.json`. Idempotent — running twice just prints `Not logged in` the second time.

```bash
lumo auth logout
```

Use when the user says "log out", "sign out", or wants to clear credentials before switching accounts (then run `lumo auth login` to re-auth).

### `lumo whoami` — show current identity

Reads the local credentials file (no network call — it does **not** prove the key still works) and prints one line: email, workspace slug, API key prefix. `--full` adds the workspace name, key name and API URL; `--json` emits `{ email, workspace: { slug, name }, apiKey: { name, prefix }, apiUrl }` (never the token).

```bash
lumo whoami
# cli@uselumo.ai · workspace lumo · key lum_68d4...
lumo whoami --full
# Logged in as cli@uselumo.ai
#   Workspace: Lumo (lumo)
#   Key: Claude Code (lum_68d4...)
#   API: https://www.uselumo.ai
```

Not a pre-flight check: don't run it (or `lumo --version`) before other commands. The SessionStart status line already carries the CLI version and identity, and a command that hits an auth failure ends with a line pointing at `lumo auth login` (added by the CLI even when the command itself only saw `HTTP 401`).

#### When to suggest

- The user asks "who am I", "which workspace am I in", "what account is this"
- You need to disambiguate whether `lumo task list` would hit the user's expected workspace
- Before suggesting a destructive command on a shared machine — confirm the identity is right

## Self-Update

### `lumo update` — upgrade the CLI to the latest npm release

Synchronously checks `registry.npmjs.org` for the latest published version of `@lumoai/cli`. When a newer version exists, runs `npm install -g @lumoai/cli@latest` and streams npm's output. When already on the latest, exits cleanly with a "Already on the latest version (X)" message.

```bash
lumo update
```

The CLI also performs a passive check at most once every 24 hours (a detached child process refreshes a cache at `~/.lumo/update-check.json`), and prints a one-line "Update available" notice on subsequent invocations when a newer version is in the cache.

#### When to suggest

- The user asks "how do I update", "upgrade lumo", "is there a new version"
- A bug-fix or feature mentioned in conversation requires a newer CLI than the user is running
- The passive notice has appeared and the user wants to act on it

If `npm install -g` fails (permissions, npm not on PATH, alternative package manager), `lumo update` prints a fallback hint instructing the user to run the install command manually. Do not auto-retry; let the user resolve the environment issue first.
