# Onboarding, authentication & self-update

Nothing of Lumo is installed into an agent's skill directory: this guide is read on demand with `lumo skill read`, and `lumo init` only wires hooks into the **current git repository**.

## `lumo skill read [path]` — read this guide

Prints `SKILL.md` (no argument) or any other file of the guide shipped in the CLI package. Local, no login, no network. A path outside the guide (`../x`, an absolute path) exits 2; an unknown file exits 1 and lists the files.

```bash
lumo skill read                         # the entry point (SKILL.md)
lumo skill read references/tasks.md     # one reference
```

The Lumo SessionStart context tells the agent to run it before other `lumo` commands when a request involves Lumo.

## `lumo init [--agent <token>] [--dry-run] [--scan-hooks]` — set up this repo

Run inside the git repository. Without `--agent` it sets up **Claude Code and Codex** at once:

- **Claude Code** — merges the Lumo hook entries into `./.claude/settings.json` (your own permissions and non-Lumo hooks are kept; a re-run replaces only Lumo's entries and removes ones it no longer uses).
- **Codex** — merges the Lumo hook entries into `./.codex/hooks.json` and writes `./.codex/rules/lumo.rules`, which lets `lumo` commands reach the Lumo API from Codex's no-network sandbox (see [codex.md](codex.md)). **Codex runs a hook only after the user trusts it** (Codex CLI `/hooks`, Codex app Settings → Hooks); until then it is skipped silently. A re-run rewrites `hooks.json` only when the Lumo entries changed and then names the events to trust again. Codex loads rules at startup — restart it after `init`.
- **git** — a `prepare-commit-msg` hook that appends the branch's task id (`[LUM-N]`, from a `lumo/LUM-N-…` branch) to a commit subject that lacks it. Pure sh + git, merged between `# >>> lumo prepare-commit-msg >>>` / `# <<< lumo <<<` markers, keeping any existing hook. Under `core.hooksPath` (husky etc.) it is printed with instructions instead of written.

`--agent <token>` narrows to one agent (`claude-code` → `.claude/` only, `codex` → `.codex/` only) and is baked into every hook command (`lumo hook <slug> --agent <token>`) so sessions and memories are attributed to that agent. Valid tokens: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini`, `copilot` accepted); other agents use the Claude Code layout. An unknown token aborts before writing anything.

`--scan-hooks` (opt-in) also adds `pre-commit` / `pre-push` hooks running `lumo security scan` ([security-scan.md](security-scan.md#git-hooks)): they block only on a finding that would block DONE; a failed scan, no network or no `lumo` on PATH never blocks; `git commit|push --no-verify` skips them. A re-run without the flag leaves installed scan hooks alone.

`--dry-run` writes nothing and prints, per file, `would install` / `would update` / `·` (up to date) / `⚠ skip` / `✗ cannot plan` (exit 1) with a diff. Settings and `hooks.json` diffs show **only** the `lumo hook …` entries (everything else folded to `"… N other …"`); a Codex change is flagged `⚠ Codex will ask to trust these hooks again — events: …`. It ends with `N of M would change` and the command to apply.

When logged in, `init` ends with one `ℹ Session records in this workspace: …` line (retention mode; an OWNER changes it in Settings → Data retention). The files it writes are plain repo files — commit them in a PR so the team gets the same hooks.

```bash
lumo init                       # this repo: Claude Code + Codex + git hook
lumo init --dry-run             # preview with diffs, nothing written
lumo init --agent codex         # Codex only (then trust the hooks in /hooks, restart Codex)
lumo init --agent claude-code   # Claude Code only
lumo init --agent cursor        # bake agent=cursor into the hook commands
lumo init --scan-hooks          # also pre-commit / pre-push security scans
```

**When to suggest:** the user asks how to set up Lumo in a repo; a repo has no Lumo hooks yet; the user works in Codex; a `lumo` command in Codex fails with `fetch failed` (rules missing or from an older CLI — re-run `lumo init`, restart Codex, run `lumo` unpiped); before re-running on hand-edited hook files (`--dry-run` first, show the diff); the user wants secrets caught on every commit/push (`--scan-hooks`, never on your own).

## `lumo doctor [--json]` — check this repo's setup (read-only)

Reports the current repo's Lumo hooks in `.claude/settings.json` and `.codex/hooks.json` (missing events, entries from another `--agent`), the Codex rule `.codex/rules/lumo.rules`, Codex hook trust (a text scan of `~/.codex/config.toml`, shown as `trusted (hash not verified)` or "open `/hooks` and Trust"), the git hooks, whether `lumo` is on PATH, and login / server connectivity — each row with a fix command. Exit code is always 0. `--json` prints `{ version: 2, cliVersion, repo, rows, warnings, autoUpdate, auth }`.

```bash
lumo doctor
lumo doctor --json
```

**When to suggest:** hooks do not fire, Codex says hooks are untrusted, or the user asks whether Lumo is set up correctly. For a file-level diff use `lumo init --dry-run`.

## `lumo uninstall [--agent <token>] [--purge] --confirm` — remove this repo's Lumo entries (gated)

Removes only Lumo's entries from this repo: the `lumo hook` entries in `.claude/settings.json` and `.codex/hooks.json` (the files and every other hook stay), the Lumo-marked `.codex/rules/lumo.rules`, and the marked blocks of `prepare-commit-msg` / `pre-commit` / `pre-push`. `--agent` limits it to one agent's entries (`--agent git` = the git hooks); `--purge` also empties `~/.lumo` (credentials, caches — the user logs in again). Without `--confirm` it prints the confirmation envelope (exit 4) listing every path and action and changes nothing — relay it, re-run `confirmCommand` only after the user approves ([confirmation.md](confirmation.md)). Committed paths are flagged; nothing is committed for you. The last line is the manual step `npm rm -g @lumoai/cli`.

```bash
lumo uninstall                          # envelope, nothing changes
lumo uninstall --confirm                # after the user approved
lumo uninstall --agent codex --confirm
```

**When to suggest:** the user wants Lumo removed from this repo. Never run it, or add `--confirm`, on your own initiative.

## Authentication

```bash
lumo auth login     # opens the API Keys page; paste a key starting with lum_
lumo auth logout    # clears ~/.lumo/credentials.json (idempotent)
lumo whoami         # cli@uselumo.ai · workspace lumo · key lum_68d4...
lumo whoami --full  # + workspace name, key name, API URL
```

- `auth login` is the only auth path (no `--token`). Suggest it when a command reports `not logged in`, `API key invalid or revoked`, or ends with the `Hint: … HTTP 401 … lumo auth login` line, and when the user switches workspaces.
- `whoami` reads local credentials only (no network — it does not prove the key works); `--json` prints `{ version, email, workspace: { slug, name }, apiKey: { name, prefix }, apiUrl }` (never the token). **Not a pre-flight check** — don't run it (or `lumo --version`) before other commands. Use it when the user asks which account/workspace this is, or before a destructive command on a shared machine.

## `lumo update [--auto on|off]` — upgrade the CLI

`lumo update` checks npm for the latest `@lumoai/cli` and runs `npm install -g @lumoai/cli@latest` when newer. If npm fails (permissions, no npm on PATH) it prints the manual command — don't retry in a loop.

**Auto-update (default on):** a background worker installs a newer release at most once per 24 h, only for a global npm install (not `npm link`, a checkout or npx). Off with `lumo update --auto off`, `LUMO_NO_AUTO_UPDATE=1`, or a non-empty `CI` other than `false`/`0`. It never prints and never blocks a hook; failures go to `auto-update.json` and the normal "Update available" notice still shows. A manual `lumo update` exits 1 while a background install runs.

```bash
lumo update
lumo update --auto off
lumo update --auto on
```

**CLI ↔ server version hints.** Every API request carries `X-Lumo-Cli-Version` (a compatibility signal, never auth). A server that no longer supports this CLI answers HTTP 426 and the command ends with ``Hint: the Lumo server no longer supports this CLI <v> (HTTP 426; it needs <min> or newer). Run `lumo update` to upgrade.`` — suggest `lumo update`. A command newer than the deployed server gets ``Hint: the Lumo server has no API for `lumo <command>` (HTTP 404) — it may not have deployed this feature yet. …`` — the server needs a deploy; run the command again once it has shipped, not in a loop. A JSON 404 (a task that doesn't exist) never prints it.

**When to suggest:** the user asks to update; a needed fix is in a newer CLI; the "Update available" notice appeared; a command ended with the HTTP 426 hint. After an upgrade, a running agent session keeps the guide it already read — re-read it with `lumo skill read` if behaviour changed.
