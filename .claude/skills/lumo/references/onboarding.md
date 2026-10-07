# Onboarding, Authentication & Self-Update

## Onboarding

### `lumo setup [--user|--project] [--force] [--agent <token>]` — install skill + hooks

Bootstraps Lumo into a coding-agent installation. Copies the bundled skill files (`SKILL.md` **and its `references/` directory**) into `<scope>/.claude/skills/lumo/` and idempotently merges 25 hook entries into `<scope>/.claude/settings.json`. Existing user permissions and non-Lumo hook entries are preserved.

Setup records the skill directory in `~/.lumo/skill-installs.json` (user and project scope alike) so `lumo update` / `lumo skill sync` can refresh it later. An existing skill that differs from the bundle is left alone without `--force`.

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

`--agent <token>` records which coding agent these hooks run under and is **baked into every hook command** (`lumo hook <slug> --agent <token>`). Each hook then sends the agent to the server, where it's stored on the Session and inherited by auto-sedimented memories — so a memory is attributed to the agent that produced it instead of the default. Valid tokens: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases). **Defaults to `claude-code`.** Re-running setup with a different `--agent` rewrites the token in place (no duplicate hook entries), and a legacy flagless entry is upgraded on the next run.

```bash
npx @lumoai/cli setup                    # interactive: prompts user/project; agent=claude-code
npx @lumoai/cli setup --user             # write to ~/.claude/
npx @lumoai/cli setup --project          # write to ./.claude/
lumo setup --project --force             # same via global install: overwrite skill files if they differ from bundled
lumo setup --project --agent codex       # bake agent=codex into the hook commands
```

#### When to suggest

- The user asks "how do I set up lumo", "install the lumo skill", "wire up lumo hooks"
- A fresh checkout of a project that uses Lumo doesn't have `.claude/skills/lumo/SKILL.md` yet
- After `npm install -g @lumoai/cli`, before the first `lumo auth login`
- Wiring Lumo into a non-Claude-Code agent (Codex / Cursor / …) — pass `--agent <token>` so its memories are attributed correctly

If stdin is not a TTY (CI, piped invocation), the default scope is `project` and no prompt is shown. An unrecognized `--agent` token aborts before writing anything.

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

After a successful upgrade it runs the **newly installed** binary's `lumo skill sync`, so the installed skill files match the new CLI. When already on the latest version (or ahead of it) it runs the sync in-process instead — that catches a CLI upgraded with a bare `npm install -g`. A failed npm install skips the sync.

The CLI also performs a passive check at most once every 24 hours (a detached child process refreshes a cache at `~/.lumo/update-check.json`), and prints a one-line "Update available" notice on subsequent invocations when a newer version is in the cache.

#### When to suggest

- The user asks "how do I update", "upgrade lumo", "is there a new version"
- A bug-fix or feature mentioned in conversation requires a newer CLI than the user is running
- The passive notice has appeared and the user wants to act on it

If `npm install -g` fails (permissions, npm not on PATH, alternative package manager), `lumo update` prints a fallback hint instructing the user to run the install command manually. Do not auto-retry; let the user resolve the environment issue first.

### `lumo skill sync` — refresh installed skill files

Overwrites every installed copy of the lumo skill with the one bundled in the running CLI (same semantics as `setup --force` for the skill files; `references/` is replaced wholesale; hooks in `settings.json` are not touched). Targets: every location `lumo setup` recorded in `~/.lumo/skill-installs.json`, plus `~/.claude/skills/lumo` and `./.claude/skills/lumo` when they already hold a skill (installs made before the registry existed — they get recorded). One line per location:

```bash
lumo skill sync
# ✓ updated skill (31 files): /Users/me/code/app/.claude/skills/lumo
# ✓ skill already up to date: /Users/me/.claude/skills/lumo
# - no longer installed, forgotten: /Users/me/code/old-app/.claude/skills/lumo
# - skipped Lumo source checkout (skill source, not an install): /Users/me/code/lumo/.claude/skills/lumo
```

A location that can't be read or written prints `✗ could not refresh (<reason>): <path>`, stays registered for the next run, and makes the command exit 1 — the other locations are still refreshed. A recorded location without `SKILL.md` is dropped from the registry. The Lumo monorepo's own `.claude/skills/lumo/` is the skill's source and is never overwritten. No installs found → prints a pointer to `lumo setup`, exit 0.

#### When to suggest

- The CLI was upgraded outside `lumo update` (bare `npm install -g`, another package manager) and the skill docs look stale
- `lumo update` reported it could not refresh the skill files
