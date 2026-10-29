# Onboarding, authentication & self-update

This guide is never copied into a repo or home: it is read on demand with `lumo skill read`. `lumo init` wires hooks into the **current git repository** and writes a tiny frozen skill stub there (below) that only points at `lumo skill read`.

## `lumo skill read [path]` — read this guide

Prints `SKILL.md` (no argument) or any other file of the guide shipped in the CLI package. Local, no login, no network. A path outside the guide (`../x`, an absolute path) exits 2; an unknown file exits 1 and lists the files.

```bash
lumo skill read                         # the entry point (SKILL.md)
lumo skill read references/tasks.md     # one reference
```

The Lumo SessionStart context tells the agent to run it before other `lumo` commands when a request involves Lumo.

## `lumo init [--agent <token>] [--dry-run] [--scan-hooks [--scan-log]]` — set up this repo

Run inside the git repository (or, see below, a plain folder). Without `--agent` it sets up **Claude Code and Codex** at once:

- **Claude Code** — merges the Lumo hook entries into `./.claude/settings.json` (your own permissions and non-Lumo hooks are kept; a re-run replaces only Lumo's entries and removes ones it no longer uses).
- **Codex** — merges the Lumo hook entries into `./.codex/hooks.json` and writes `./.codex/rules/lumo.rules`, which lets `lumo` commands reach the Lumo API from Codex's no-network sandbox (see [codex.md](codex.md)). **Codex runs a hook only after the user trusts it** (Codex CLI `/hooks`, Codex app Settings → Hooks); until then it is skipped silently. A re-run rewrites `hooks.json` only when the Lumo entries changed and then names the events to trust again. Codex loads rules at startup — restart it after `init`.
- **Skill stub** — `./.claude/skills/lumo/SKILL.md` (Claude Code) and `./.agents/skills/lumo/SKILL.md` (Codex), per selected agent. It gives the agent `/lumo` / `$lumo` and a Lumo row in its skill list; its body only says to run `lumo skill read`. Its content never changes between CLI versions, so it is never out of date with the guide; an existing file with different content is overwritten, an identical one is left alone.
- **git** — a `prepare-commit-msg` hook that appends the branch's task id (`[LUM-N]`, from a `lumo/LUM-N-…` branch) to a commit subject that lacks it. Pure sh + git, merged between `# >>> lumo prepare-commit-msg >>>` / `# <<< lumo <<<` markers, keeping any existing hook. Under `core.hooksPath` (husky etc.) it is printed with instructions instead of written.

`--agent <token>` narrows to one agent (`claude-code` → `.claude/` only, `codex` → `.codex/` and `.agents/` only) and is baked into every hook command (`lumo hook <slug> --agent <token>`) so sessions and memories are attributed to that agent. Valid tokens: `claude-code | codex | cursor | gemini-cli | github-copilot | windsurf` (case-insensitive; `gemini`, `copilot` accepted); other agents use the Claude Code layout. An unknown token aborts before writing anything.

`--scan-hooks` (opt-in) also adds `pre-commit` / `pre-push` hooks running `lumo security scan` ([security-scan.md](security-scan.md#git-hooks)): they block only on a finding that would block DONE; a failed scan, no network or no `lumo` on PATH never blocks; `git commit|push --no-verify` skips them. A re-run without the flag leaves installed scan hooks alone.

`--scan-log` (with `--scan-hooks`) also records each commit's local scan on the Lumo server: a `post-commit` hook and the `pre-push` hook run `lumo security scan --log` in the background, never blocking or failing a commit or push, and `git config lumo.scanLog true` is set for the repo (the switch; `false` pauses it, `lumo uninstall` removes the hook and unsets it). The server keeps the results only once an OWNER opted the workspace in (`lumo workspace security-scan update --local-scan-log on`). Without `--scan-hooks` it exits 2. See [security-scan.md](scan-log.md).

`--dry-run` writes nothing and prints, per file, `would install` / `would update` / `·` (up to date) / `⚠ skip` / `✗ cannot plan` (exit 1) with a diff. Settings and `hooks.json` diffs show **only** the `lumo hook …` entries (everything else folded to `"… N other …"`); a Codex change is flagged `⚠ Codex will ask to trust these hooks again — events: …`. It ends with `N of M would change` and the command to apply.

**Not a git repo (folder install).** Outside any git repo `init` installs into the current folder (for projects that live under a non-git parent such as `~/projects/`). It prints the files it would write, warns that they cannot be shared via git and apply only to sessions started in that folder (a project inside it with its own `lumo init` uses its own install; verified: Claude Code and Codex run only the install of the folder they start in, never both), then asks `Install Lumo here anyway? [y/N]`. Only `y`/`yes` proceeds; anything else, EOF or no answer in 60 s prints `Nothing written.` and exits 0. **An agent must not answer this prompt itself**: relay the warnings to the user and pipe their answer in. No git hook is installed; `--scan-hooks` needs a repo (exit 2); `--dry-run` previews with the warnings and never prompts. `$HOME` and `/` are refused (exit 1). `doctor` and `uninstall` work in a folder install too (files are "local", never "committed"); `uninstall` keeps its `--confirm` gate.

When logged in, `init` ends with one `ℹ Session records in this workspace: …` line (retention mode; an OWNER changes it in Settings → Data retention). The files it writes are plain repo files — commit them in a PR so the team gets the same hooks.

```bash
lumo init                       # this repo: Claude Code + Codex + git hook
lumo init --dry-run             # preview with diffs, nothing written
lumo init --agent codex         # Codex only (then trust the hooks in /hooks, restart Codex)
lumo init --agent claude-code   # Claude Code only
lumo init --agent cursor        # bake agent=cursor into the hook commands
lumo init --scan-hooks          # also pre-commit / pre-push security scans
lumo init --scan-hooks --scan-log  # …and record each commit's scan on the server (opt-in)
```

**When to suggest:** the user asks how to set up Lumo in a repo; a repo has no Lumo hooks yet; the user works in Codex; a `lumo` command in Codex fails with `fetch failed` (rules missing or from an older CLI — re-run `lumo init`, restart Codex, run `lumo` unpiped); before re-running on hand-edited hook files (`--dry-run` first, show the diff); the user wants secrets caught on every commit/push (`--scan-hooks`, never on your own).

## `lumo doctor [--json]` — check this repo's setup (read-only)

Reports the current repo's Lumo hooks in `.claude/settings.json` and `.codex/hooks.json` (missing events, entries from another `--agent`), the Codex rule `.codex/rules/lumo.rules`, the skill stubs (`ok` / `missing` / `differs` → `lumo init`), Codex hook trust (a text scan of `~/.codex/config.toml`, shown as `trusted (hash not verified)` or "open `/hooks` and Trust"), the git hooks, whether `lumo` is on PATH, and login / server connectivity — each row with a fix command. Exit code is always 0. `--json` prints `{ version: 2, cliVersion, repo, rows, warnings, autoUpdate, auth }`.

```bash
lumo doctor
lumo doctor --json
```

**When to suggest:** hooks do not fire, Codex says hooks are untrusted, or the user asks whether Lumo is set up correctly. For a file-level diff use `lumo init --dry-run`.

## `lumo uninstall [--agent <token>] [--purge] --confirm` — remove this repo's Lumo entries (gated)

Removes only Lumo's entries from this repo: the `lumo hook` entries in `.claude/settings.json` and `.codex/hooks.json` (the files and every other hook stay), the Lumo-marked `.codex/rules/lumo.rules`, the skill stub files (their `lumo` directory too when empty; other skills are never touched), and the marked blocks of `prepare-commit-msg` / `pre-commit` / `pre-push`. `--agent` limits it to one agent's entries (`--agent git` = the git hooks); `--purge` also empties `~/.lumo` (credentials, caches — the user logs in again). Without `--confirm` it prints the confirmation envelope (exit 4) listing every path and action and changes nothing — relay it, re-run `confirmCommand` only after the user approves ([confirmation.md](confirmation.md)). Committed paths are flagged; nothing is committed for you. The last line is the manual step `npm rm -g @lumoai/cli`.

```bash
lumo uninstall                          # envelope, nothing changes
lumo uninstall --confirm                # after the user approved
lumo uninstall --agent codex --confirm
```

**When to suggest:** the user wants Lumo removed from this repo. Never run it, or add `--confirm`, on your own initiative.

## Authentication

```bash
lumo auth login     # opens the API Keys page; paste a key starting with lum_
lumo auth login --url http://localhost:3000   # a self-hosted server; in local mode it issues the key itself
lumo auth use http://localhost:3000           # this repository uses that login (--default: every unbound repo; --unbind)
lumo auth logout    # removes the login this directory uses (--url <url>: that server's); others stay
lumo whoami         # every login; * = the one this directory uses
lumo whoami --full  # + workspace name, key name, API URL, this repository's binding
```

- **Several logins side by side** (one per server, e.g. the hosted service and a local `http://localhost:3000`), all in `~/.lumo/credentials.json` (user-level, 0600, never committed). Which one a command **and every Claude Code / Codex hook** uses, by the directory it runs in: `LUMO_API_URL` when it names a server you are logged in to (that login's own token) → the repository's binding (keyed by the repo's main work tree, so all its worktrees share it) → the default (the first login; change with `auth use <url> --default`). A binding to a server no longer logged in falls back to the default (hooks note it in `hook.log`, never fail). A repository can only be bound to a server you logged in to yourself — nothing in a repo can redirect tokens or session records. `LUMO_CONFIG_DIR` still swaps the whole directory. A single-login file from an older CLI is read as the default, no re-login.
- `--url <url>` logs in to that server (a self-hosted Lumo) instead of `LUMO_API_URL` / the hosted service; https only, http for localhost. When the server runs `LUMO_MODE=local` (`setup.sh --local`), it issues an API key for its one account (creating the account if nobody opened the app yet) and nothing is pasted (`Local mode: <url> issued an API key for this machine.`). Any other server — the hosted one, a normal self-host, an older one — gets the usual paste flow. A local-mode server that refuses (several accounts) prints `Local mode did not issue a key: <reason>` first. `--no-paste` exits 1 instead of prompting or opening a browser when no key is issued (for scripts). Logging in replaces only an earlier login **to the same server**. Run inside a git repository, a login that is not the default also binds that repository to it (`Used by: <repo>`); re-logging in to the default there drops the binding. `--no-bind` stores the login without binding (scripts; `setup.sh --local` uses it). Outside a repo a non-default login prints `Not used yet — …` with the `auth use` commands.
- `auth use [url]` never logs in: an unknown server exits 1 with `Hint: lumo auth login --url <url>`; outside a git repository (without `--default`) exits 1; no URL and no `--unbind` exits 2.
- `auth logout` without `--url` removes the login this directory resolves to; with `--url`, that server's (not logged in there → `Not logged in to <url>`, exit 0). Bindings to it are dropped; when the default goes and one login remains, that one becomes the default.
- `auth login` is the only auth path (no `--token`). Suggest it when a command reports `not logged in`, `API key invalid or revoked`, or ends with the `Hint: … HTTP 401 … lumo auth login` line, and when the user switches workspaces.
- `whoami` reads local credentials only (no network — it does not prove the key works); a login to a self-hosted Lumo ends with ` · local · <url>` (this machine) or ` · self-hosted · <url>` (`--full`: a `Server:` line), the hosted one with nothing — tell the user which server they are on when it matters (their session records go there). With several logins each gets its own line, `* ` marking the one used here and tags `(default)` / `(this repo)` / `(LUMO_API_URL)`; one login prints exactly one line as before. `--json` prints `{ version, email, workspace: { slug, name }, apiKey: { name, prefix }, apiUrl, logins: [{ apiUrl, email, workspace, apiKey, default, used }] }` — the top-level fields are the login used here (never the token). **Not a pre-flight check** — don't run it (or `lumo --version`) before other commands. Use it when the user asks which account/workspace this is, or before a destructive command on a shared machine.

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
