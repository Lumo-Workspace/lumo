# Onboarding, Authentication & Self-Update

## Onboarding

### `lumo init [--user|--project] [--force] [--agent <token>] [--dry-run]` — install or refresh skill + hooks (alias: `lumo setup`)

Bootstraps Lumo into **Claude Code and Codex at once** (no agent detection — both are always set up; LUM-1054). For Claude Code it copies the bundled skill files (`SKILL.md` **and its `references/` directory**) into `<scope>/.claude/skills/lumo/` and idempotently merges 25 hook entries into `<scope>/.claude/settings.json`; for Codex it does the Codex setup below. Existing user permissions and non-Lumo hook entries are preserved. Each install is recorded in the install registry. **`--agent <token>`** narrows it to that one agent (old scripts keep working): `--agent claude-code` writes only `.claude/`, `--agent codex` only `.agents/` + `.codex/`.

**Codex setup** (no `--agent`, or `--agent codex`): the same skill files go to `<scope>/.agents/skills/lumo/` (Codex loads skills from there in the CLI, desktop app and IDE extension), and 12 hook entries are merged into `<scope>/.codex/hooks.json` (`~/.codex/hooks.json` for `--user`) — the 9 events Codex shares with Claude Code plus Codex's `PreCompact` / `PostCompact` / `Interrupt`. **Codex runs a hook only after the user trusts it** (Codex app: Settings → Hooks → Trust each `lumo hook …` entry; Codex CLI: `/hooks`); until then it is skipped silently, so setup prints that step and `session attach` / `session status` warn when no hook event has arrived — or, once some arrive, list the Lumo events that may not be trusted (text scan of `~/.codex/config.toml`). Hook commands are byte-stable (`lumo hook <slug> --agent codex`) and an unchanged file is never rewritten, so re-running `init` or upgrading the CLI does not ask for trust again; auto-sync never touches Codex hooks, and re-running `init` rewrites them only when the Lumo event set changed (it then prints "re-trust in Codex /hooks" and `Events to trust again: <Event> (added|updated), …`). `init` records the file in the install registry (kind `codex-hooks`). The `--project` git hook below is installed once, whichever agents are set up.

**Codex sandbox network.** Codex's default `workspace-write` sandbox has no network, so a `lumo` command in a Codex shell failed with `could not reach Lumo API … (fetch failed)` (hooks run outside the sandbox and were unaffected). Init therefore writes a Codex rules file, `<scope>/.codex/rules/lumo.rules` (`~/.codex/rules/lumo.rules` for `--user`), with `prefix_rule(…, decision = "allow")`s for the **server-only** `lumo` commands only (they just call the Lumo API — reading only Lumo's config/credentials or read-only git — and never read an arbitrary local file to upload or write one; generated from `CODEX_SERVER_ONLY_COMMANDS` in `cli/src/lib/codex-rules.ts`, narrow prefixes such as `["lumo", "task", ["show", "context", …]]`, with `match`/`not_match` examples Codex validates at load): those run **outside the sandbox without prompting**. The `lumo` commands with local effects (`init`/`setup`, `skill update`, `uninstall`, `update`, `auth`, `worktree`, `memory sync/push`, `hook`, `session attach`, `task update`) the commands that can read a local file and upload it (`--file` on `doc create/update/patch/append/diff`, `task artifact add`, `task template create/edit`, `crossing explain`, `milestone criteria set`; `task testcase run --evidence-file`; `usage resync` reads transcripts — `CODEX_FILE_READING_COMMANDS`) and the human-only dispositions stay sandboxed, so Codex asks before running them outside it; every other command stays sandboxed without network (Codex's `network_access` is not touched). A jest test fails when a new CLI command is not classified. Codex loads rules at startup — restart it after init — and loads a project's `.codex/rules/` only once the project is trusted. A compound command is split per command, so `lumo a && lumo b` is allowed, but piping or redirecting (`lumo … | head`, `lumo … > f`) runs the whole line sandboxed — run `lumo` as its own command. The file starts with a `# Managed by \`lumo init\``marker: re-running init leaves it byte-identical and rewrites a Lumo-marked copy that differs, a`lumo.rules`without the marker is the user's and is left alone (replaced only with`--force`), registry kind `codex-rules`. When a command run inside Codex's sandbox (`CODEX_SANDBOX`set) cannot reach the API (a fetch rejected the way the sandbox denies network — `fetch failed`with`ENOTFOUND`/`EPERM`/`EACCES`/`EAI_AGAIN`; not timeouts, and never once any request got a response), it ends with a`Hint:`paragraph naming the cause and the fix — for a sandboxed-on-purpose command: approve it in Codex or run it yourself; otherwise run`lumo init`, restart Codex, run `lumo`unpiped, or as the broad alternative add`[sandbox_workspace_write]` `network_access = true`to`~/.codex/config.toml` (opens network to every sandboxed command). The npm package root is also a portable Agent Plugins package (`plugin.json`+`skills/lumo/`), so a Codex / ChatGPT plugin marketplace can list `@lumoai/cli`as an`npm` source.

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

For every other agent (`cursor`, …), `--agent <token>` uses the Claude Code layout and records which coding agent these hooks run under and is **baked into every hook command** (`lumo hook <slug> --agent <token>`). Each hook then sends the agent to the server, where it's stored on the Session and inherited by auto-sedimented memories — so a memory is attributed to the agent that produced it instead of the default. Valid tokens: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini` and `copilot` are accepted aliases). Without `--agent` the Claude Code hooks carry `claude-code` and the Codex hooks `codex`. Re-running setup with a different `--agent` rewrites the token in place (no duplicate hook entries), and a legacy flagless entry is upgraded on the next run.

```bash
npx @lumoai/cli init                     # interactive: prompts user/project; sets up Claude Code + Codex
npx @lumoai/cli init  --user             # write to ~/.claude/, ~/.agents/ and ~/.codex/
npx @lumoai/cli init  --project          # write to ./.claude/, ./.agents/ and ./.codex/
lumo init --project --force             # same via global install: overwrite skill files if they differ from bundled
lumo init --project                     # re-run = refresh: unchanged files are not rewritten; skills managed+older only (modified/newer skipped, never downgrades); Codex hooks.json only when the Lumo event set changed (then re-trust the listed events in Codex /hooks)
lumo init --project --dry-run           # preview: per file the path, action and unified diff; writes nothing
lumo init --project --agent codex       # Codex only: ./.agents/skills/lumo/, ./.codex/hooks.json (then trust them), ./.codex/rules/lumo.rules
lumo init --project --agent claude-code # Claude Code only: ./.claude/
lumo setup --project                    # legacy hidden alias of `lumo init`
lumo init --project --agent cursor      # bake agent=cursor into the hook commands
```

**Refreshing an install (LUM-1118).** `lumo init --upgrade` was removed (it now exits 1 naming the replacement): re-run `lumo init` with the install's scope (`--user` / `--project`) and, to leave other agents alone, its `--agent`. It refreshes only that scope — run `lumo init --project` inside each repo — and, unlike the old `--upgrade`, also installs what is missing there (the preview shows it as `would install`).

**Previewing (LUM-1113).** `lumo init --dry-run` resolves the scope like `init` (prompt / `--user` / `--project`), visits the same files with the same `--agent` / `--force` and decides each one with the same code, but writes nothing — no install file, `.lumo-install.json` marker, install-registry record or lock, and neither the first-run auto-sync nor the update check / background auto-update runs first. Per file it prints one line — `would install` / `would update` / `would adopt` (legacy copy: only the marker would be written) / `·` (up to date) / `⚠ skip` (modified without `--force`, newer, a `lumo.rules` Lumo did not write, the Lumo source repo, a `core.hooksPath` git hook) / `✗ cannot plan` (e.g. unparseable JSON; exit 1) — then the details indented: a skill dir gets the `lumo skill update --dry-run` file list (`~ SKILL.md (+12 −3)`) plus a unified diff per file; Claude `settings.json` and Codex `hooks.json` get a diff of a normalized view that keeps **only** the `lumo hook …` entries and their group's `matcher` (events sorted, every other hook, group, event and setting folded to `"… N other …"`, so nothing of the user's own config is printed); the Codex rule a diff of the whole Lumo-owned file; `prepare-commit-msg` a diff of the Lumo block only. A Codex `hooks.json` change is flagged `⚠ Codex will ask to trust these hooks again — events: …` (a file with no Lumo entries yet: `⚠ Codex runs these hooks only after you trust them`; Claude settings, rules and the git hook never need Trust). The first line is `Lumo init --dry-run — <scope> scope, nothing is written (CLI <v>)`; the last `N of M would change` (with how many need Codex trust) plus ``Run `lumo init --<scope> …` to apply``, or `Nothing to change — …`. Diff lines are indented four spaces.

#### When to suggest

- The user asks "how do I set up lumo", "install the lumo skill", "wire up lumo hooks"
- A fresh checkout of a project that uses Lumo doesn't have `.claude/skills/lumo/SKILL.md` (or, for Codex, `.agents/skills/lumo/SKILL.md`) yet
- The user works in Codex — `lumo init` covers it (add `--user` for every repo)
- A `lumo` command in Codex fails with `fetch failed` — the Codex rule is missing (installed before CLI 1.102, or an untrusted project) or the command was piped; re-run `lumo init` / `lumo init --agent codex` and restart Codex
- After `npm install -g @lumoai/cli`, before the first `lumo auth login`
- Before re-running `lumo init` for a security-conscious team, or on a machine whose hook files were hand-edited — `--dry-run` first and show the user the diffs
- Wiring Lumo hooks into another agent (Cursor / …) — pass `--agent <token>` so its memories are attributed correctly

If stdin is not a TTY (CI, piped invocation), the default scope is `project` and no prompt is shown. An unrecognized `--agent` token aborts before writing anything.

### `lumo doctor [--json]` — inspect every Lumo install (read-only)

Lists what Lumo installed on this machine and in the current repo, grouped as `This machine` (user-scope paths, the default `.git/hooks`), `This repo — committed` (git-tracked, incl. a tracked `core.hooksPath` dir), `This repo — uncommitted` and `Other repos` (recorded project installs outside the current repo). Sources: the install registry (skills, Claude settings, git hooks, Codex hooks and rules; stale paths warn), the known skill locations, `~/.claude/settings.json` and `<repo>/.claude/settings.json` Lumo hook entries, the `prepare-commit-msg` block (honours `core.hooksPath`), `~/.codex/hooks.json` / `<repo>/.codex/hooks.json` `lumo hook` entries and the Lumo `.codex/rules/lumo.rules` (kind `codex-rules`: `up to date`, or `outdated` → `lumo init --<scope> --agent codex`). Each row shows path, kind, version, state and a fix command:

| State            | Meaning                                                                                           | Suggested command                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `up to date`     | matches this CLI                                                                                  | none                                                                                                                          |
| `behind CLI <v>` | older than what CLI version `<v>` would install — a managed skill copy, or a stale git-hook block | `lumo init --<scope> --agent <a>` (git hook: `lumo init --project`); an `Other repos` row adds "run the command in that repo" |
| `modified`       | edited locally                                                                                    | `lumo init --force` (discards the edits — only if the user wants that)                                                        |
| `newer than CLI` | installed by a newer CLI                                                                          | `lumo update`                                                                                                                 |
| `incomplete`     | Claude settings missing hook events                                                               | `lumo init --user` / `--project`                                                                                              |

Warnings (never change the exit code, which is always 0): missing Lumo hook events vs the canonical list, `lumo` not resolvable on PATH, user and project skill of one agent at different versions, an unreadable registry (reported, never rewritten), registry entries whose path is gone, Codex hooks not trusted or missing events, and `codex-no-network`: a Codex hooks file whose layer has neither the Lumo rule nor `network_access = true` in that layer's or `~/.codex/config.toml` (a project also counts the user-layer `~/.codex/rules/lumo.rules`, which Codex always loads) (row detail `network: lumo commands have no network…`, suggestion `lumo init --agent codex --<scope>`; with `network_access = true` the detail says network is on for every sandboxed command). Codex rows cover `~/.codex/hooks.json`, `<repo>/.codex/hooks.json` and recorded `codex-hooks` files; trust for all of them is a text scan of `~/.codex/config.toml` for a `[hooks.state."<hooks.json>:<event_snake>:…"]` section with a `trusted_hash`; the hash is not verified (shown as `trusted (hash not verified)`), and a missing entry means open `/hooks` in Codex and Trust (a project-level `.codex/hooks.json` with no match shows `trust unverified` — Trust only if the hooks don't fire). Trust keys are matched by both the given path and its realpath. `--json` prints `{ cliVersion, rows, warnings, autoUpdate }`, where `autoUpdate` is `{ enabled, source, eligible? }` — `source` is `default` / `setting` / `env` / `ci`, and `eligible` (present only when enabled) is `false` when this install is not a global npm install, so background updates are skipped.

```bash
lumo doctor
lumo doctor --json
```

#### When to suggest

- The user asks whether Lumo is installed correctly, why hooks do not fire, or which copies are outdated
- Before re-running `lumo init` or `--force`, to see which installs are behind (for the file-level diff: `lumo init --dry-run`)

### `lumo skill status [--json]` / `lumo skill update` — the skill copies only

`lumo skill status` (read-only) lists every Lumo skill copy — `~/.claude/skills/lumo`, `~/.agents/skills/lumo`, the same two in the current repo, and recorded installs in other repos — with scope, agent, version, state and whether git tracks it. Copies in other repos get the footer ``N in other repos — `lumo skill update` only writes the current repo; run it in that repo.`` and are not counted in the `behind` / `modified` hints. States:`up to date`, `behind CLI`(→`lumo skill update`), `newer than CLI`(→`lumo update`), `modified`(edited locally;`version`is what its marker last recorded),`source`(the Lumo repo's own`.claude/skills/lumo`). `--json`prints`{ schemaVersion: 1, cliVersion, skills: [{ path, scope, agent, version, state, gitTracked }] }`with`state`one of`up-to-date | behind | newer | modified | source`and`version`null when unknown;`schemaVersion` is bumped only on a breaking change, so other tools may rely on it.

`lumo skill update [--user|--project] [--agent <token>] [--dry-run] [--force]` replaces the copies that are behind this CLI with the bundled skill (stale files removed) and records them in the install registry. It **only** writes `…/skills/lumo` dirs: Claude settings hooks, Codex `hooks.json` and rules and the git hook are never touched (that is re-running `lumo init`, which also refreshes the skill), so Codex never asks for trust again. Same safety rules as `init`: never downgrades a newer copy (not even with `--force`); a `modified` copy is skipped unless `--force` (discards the edits); the Lumo source repo skill is never written; a git-tracked copy is changed but never committed — it prints `tracked by git — modified N files …; not committed — open a PR to commit them`. A same-version copy whose bytes differ (dev build) counts as up to date unless `--force`. `--dry-run` writes nothing (not even the registry) and lists per copy the files that would be added `+`, modified `~` or deleted `-` with approximate line counts (`~ SKILL.md (+12 −3)`). **Scope (LUM-1122):** it writes only user copies and the copies in the **current repo** (git toplevel of the cwd — inside a git worktree that is the worktree, never the main checkout). Copies the install registry records in other repos are listed by `skill status` but never written, whatever the flags or `--force`: `update` (and `--dry-run`) prints ``· <path>: in another repo — not written; run `cd <repo> && lumo skill update --project` there`` and leaves them out of the `N of M` count (when every copy found is in another repo it ends with `Nothing to update in this repo …` instead). Without a scope flag it covers both user copies and the current repo's; `--user` only the user copies (`~/.claude`, `~/.agents`); `--project` only the current repo's; `--agent` (`claude-code` = `.claude/skills/lumo`, `codex` = `.agents/skills/lumo`) narrows further. Neither command triggers the first-run auto-sync. Exit 1 on invalid flags (`--user`with`--project`, unknown `--agent`), an unreadable CLI version or bundled skill, or a failed write; skipped copies still exit 0.

```bash
lumo skill status
lumo skill status --json
lumo skill update --dry-run            # preview user + current-repo copies, nothing written
lumo skill update                      # refresh behind user + current-repo copies
lumo skill update --project --agent codex
```

#### When to suggest

- The user wants only the skill refreshed (e.g. a committed project copy is behind) without rewriting hooks — especially Codex `hooks.json`, whose rewrite needs a re-trust
- Before committing a refreshed project skill: `--dry-run` first, then `lumo skill update --project`, then open a PR
- To check which skill copies are outdated: `lumo skill status` (`--json` for scripts)
- Never add `--force` on your own initiative — it discards local edits

### `lumo uninstall` — remove what `lumo init` installed (gated)

Plans from the same collector as `lumo doctor`, so both agree on what is installed. Without `--confirm` it prints the standard confirmation envelope (exit 4) listing every path and action and changes nothing; re-run its `confirmCommand` only after the user approves. It never commits.

| Flag              | Meaning                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `--scope <s>`     | `user` (this machine) · `project` (the current repo) · `all` (default; also recorded installs in other repos) |
| `--agent <token>` | only that agent's installs (`claude-code`, `codex`, `git`, …); the git hook is labelled `git`                 |
| `--force`         | also delete skill copies edited locally (listed as `Skip …` otherwise)                                        |
| `--purge`         | also empty `~/.lumo` (credentials, caches, install registry) — the user must log in again                     |

`--agent` never matches the `prepare-commit-msg` rows unless it is `--agent git` (they belong to git, not to an agent). Only skill dirs whose path ends in `skills/lumo` are ever deleted; any other recorded skill path is listed as skipped, even with `--force`. What `--confirm` does: deletes Lumo-managed skill dirs; removes only `lumo hook` entries from `settings.json` and Codex `hooks.json` (`~/.codex/` and `<repo>/.codex/`, plus recorded ones) (file, other hooks and empty-array cleanup — the file stays); deletes the Lumo Codex rule `.codex/rules/lumo.rules` (only while it still carries the Lumo marker; an emptied `rules/` dir goes too); removes only the marked block from `prepare-commit-msg` (file deleted only when nothing but a shebang remains; under `core.hooksPath` only if the markers are present); drops registry records. Git-tracked paths are flagged "affects the whole team after you commit" — the deletion is left uncommitted for the user to review. An unreadable `installs.json` is never rewritten (only `--purge` deletes it). Codex trust entries in `config.toml` are left alone. `--purge` only works with `--scope all`. Settings/hooks JSON files are rewritten with normalized 2-space formatting. The "committed" flag follows git tracking of each path (also for other repos and dotfiles-tracked user paths). In the Lumo source repo `.claude/skills/lumo` is the skill source: `uninstall`, `init` and auto-sync never touch it (symlinks into it are resolved) and `doctor` shows it as "Lumo skill source (not an install)". The exemption covers the skill only: Claude settings and the git hook in the Lumo repo are treated like any other committed install. The last line printed is the manual step `npm rm -g @lumoai/cli`.

```bash
lumo uninstall                       # envelope, nothing changes
lumo uninstall --scope project --confirm
lumo uninstall --scope user --agent codex --confirm
lumo uninstall --purge --confirm
```

#### When to suggest

- The user wants Lumo removed from this repo or machine, or to start clean before re-running `lumo init`
- Never run it, or add `--confirm`, on your own initiative

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
lumo update               # upgrade now (prints the auto-update state)
lumo update --auto off    # stop background self-update (persists in ~/.lumo/settings.json)
lumo update --auto on     # re-enable it
```

**Auto-update (default on).** The same detached worker that refreshes the 24-hour cache runs `npm install -g @lumoai/cli@<latest>` in the background, at most once per 24 hours, and only when the running CLI is a global npm install (not `npm link`, a monorepo checkout or npx). It is disabled by `lumo update --auto off` (`{ "autoUpdate": false }` in `<config dir>/settings.json`), `LUMO_NO_AUTO_UPDATE=1`, or any non-empty `CI` other than `false`/`0`. It never prints and never blocks `lumo hook`; on failure (e.g. EACCES) the attempt and a truncated error are recorded in `auto-update.json` and the normal "Update available" notice still appears. npm output goes to `auto-update.log`; a manual `lumo update` exits 1 ("background update in progress") while one is running. `lumo init` and `lumo doctor` show the current state in one line; both check the install and say `on, but skipped for this install` when it is not a global npm install (update such a CLI yourself).

If the background npm install is still running after 120 s, `auto-update.lock` is kept until it goes stale (5 min) so a manual `lumo update` cannot start a second global install. `lumo uninstall` skips the update notice and the background worker entirely (so nothing reinstalls the CLI after `npm rm -g` or recreates `~/.lumo` after `--purge`).

**Auto-sync of installs (first run of a new CLI version).** The first command run by a new CLI version brings installs up to date, then records the version so later commands skip it in O(1):

- **User scope only** (`~/.claude/skills/lumo`, `~/.agents/skills/lumo`, and user `settings.json` hooks). Project-scope installs need an explicit `lumo init --project` in that repo.
- **Legacy adoption:** a pre-registry user copy with no `installs.json` record is adopted (marker + record) when it is an unmodified released version, then synced like any other install.
- **Never git-tracked** (symlinks are resolved, so a dotfiles-repo link counts as tracked), **never downgrades** (a newer copy prints a "run lumo update" warning), **never touches a modified copy**, and only writes dirs ending in `skills/lumo`.
- Output is at most one stderr line per changed skill (`✓ Lumo skill updated to <v>: <path>`); nothing is printed under `lumo hook`. It never fails the command. `doctor`, `uninstall` and `skill status/update` never trigger it.
- If a run hits an error, it is retried for the same version at most once every 6 hours (`lastSyncAttempt` in `installs.json`).

**Skill version on the SessionStart line (LUM-1111).** The `[Lumo] session_id=…` line carries the version of the skill copy this session loads, right after the identity: `lumo 1.118.0 · me@x (ws) · skill 1.118.0`. The copy is the one the agent picks — Claude Code: `~/.claude/skills/lumo` before the repo's `.claude/skills/lumo`; Codex: the repo's `.agents/skills/lumo` before `~/.agents/skills/lumo`. A locally edited copy shows `skill <v> modified`, the Lumo repo's own source skill `skill source`. Hints are appended as trailing ` | …` segments (existing segments never change):

- ``skill <v> is older than lumo <cli> — run `lumo skill update`, then restart the session`` — only for a managed copy behind the CLI (a newer, modified or source copy gets no hint). User-scope copies are normally refreshed by auto-sync before the hook prints, so this mostly shows for project-scope or git-tracked copies.
- `lumo upgraded <old> → <new> since this session started — restart the session to load the new skill` — a later SessionStart of the same session (resume / clear / compact) ran under a different CLI; said once, and only when a skill copy was found. The last CLI version per session id is kept in `<config dir>/session-cli-versions.json` (200 most recent sessions).
- ``committed Lumo install behind lumo <cli>: <paths> — run `lumo skill update --project` and `lumo init --project --agent codex` (preview with `--dry-run`), then commit the changes in a PR`` (LUM-1108) — the repo's **git-tracked** installs that the CLI would update: a managed project skill copy behind the CLI (`.agents/skills/lumo 1.102.0`; fix `lumo skill update --project`, which leaves hooks alone), and `.claude/settings.json` / `.codex/hooks.json` Lumo hooks or the Lumo `.codex/rules/lumo.rules` that differ from this CLI's (fix `lumo init --project`, with `--agent <a>` when they all belong to one agent); only the commands that apply are named. Auto-sync never touches these, and neither command commits — open a PR. Shown at most once per session (the first SessionStart with something to say; session ids kept in `<config dir>/session-project-install-notes.json`, 200 most recent). When it names the session's own skill copy it replaces the plain `skill … is older` hint and ends `, then restart the session`. Modified, newer, untracked and source copies, a file without Lumo hooks and a `lumo.rules` without the Lumo marker never trigger it; it applies to every agent and never shows outside a git repo.

Detection is local (no network) and silent on failure: with no skill copy, an unreadable one, or an unknown agent (not Claude Code / Codex) the line has no skill field or skill hint, and a failed committed-install probe only drops that reminder. Act on a hint by relaying it to the user; don't run `lumo skill status` just to confirm it.

**CLI ↔ server version mismatch (LUM-1110).** Every request to the Lumo API carries `X-Lumo-Cli-Version` (only requests sent with the Lumo API key; never the npm registry check). The header is a compatibility signal only — it never affects authentication. A server that knows this CLI is too old answers `HTTP 426` with `{ error, code: "CLI_VERSION_UNSUPPORTED", minVersion, cliVersion }` (floor: `MIN_SUPPORTED_CLI_VERSION` in `lib/api/cli-version-gate.ts`, overridable per deployment with `LUMO_MIN_CLI_VERSION`; requests without the header — older CLIs, browsers — always pass). The failing command then ends with ``Hint: the Lumo server no longer supports this CLI <v> (HTTP 426; it needs <min> or newer). Run `lumo update` to upgrade.`` (skipped when the command already printed `lumo update`). The other direction — a command newer than the deployed server — gets an HTML 404 page instead of a JSON error; the command then ends with ``Hint: the Lumo server has no API for `lumo <command>` (HTTP 404) — it may not have deployed this feature yet. …``. A JSON 404 (a task / doc that doesn't exist) never prints it. Both lines appear only on a non-zero exit. On the 426, suggest `lumo update`; on the 404, the server needs a deploy — run the command again once it has shipped, not in a loop. Only the last Lumo API response counts for the 404 line (a command that fell back after it and failed later doesn't get it).

The CLI also performs a passive check at most once every 24 hours (a detached child process refreshes a cache at `~/.lumo/update-check.json`), and prints a one-line "Update available" notice on subsequent invocations when a newer version is in the cache.

#### When to suggest

- The user asks "how do I update", "upgrade lumo", "is there a new version"
- A bug-fix or feature mentioned in conversation requires a newer CLI than the user is running
- The passive notice has appeared and the user wants to act on it
- A command ended with the `HTTP 426 … lumo update` hint (the server refuses this CLI version)

If `npm install -g` fails (permissions, npm not on PATH, alternative package manager), `lumo update` prints a fallback hint instructing the user to run the install command manually. Do not retry in a loop; let the user resolve the environment issue first.
