# Lumo CLI

Manage [Lumo](https://www.uselumo.ai) tasks, sessions, sprints, and documents from the terminal. Designed to pair with Claude Code and Codex so AI agents can bind to a task, load context, and update state without leaving the shell.

## Install

```bash
npm install -g @lumoai/cli
```

Verify:

```bash
lumo --version
```

## One-Shot Setup for Claude Code and Codex

Wire up the Lumo hooks for [Claude Code](https://claude.com/claude-code) and [Codex](https://developers.openai.com/codex) in one command — no install required upfront:

```bash
npx @lumoai/cli init
```

Run it inside a git repository: it sets up that repo only (`.claude/`, `.codex/` and the git hook at the repo root) and writes nothing outside it. It never asks. It:

1. Idempotently merges the Lumo hook handlers (17 Claude Code events, 9 Codex events) into `.claude/settings.json` and `.codex/hooks.json` (existing hooks and permissions are preserved). Codex runs hooks only after you trust them: Codex app Settings → Hooks, or `/hooks` in the Codex CLI
2. Writes `.codex/rules/lumo.rules`, Codex rules that let the server-only `lumo` commands (they only call the Lumo API, read no arbitrary local file and write none — `task show/context/list`, `doc show/list`, `session status`, …) run outside Codex's sandbox (which has no network) without a prompt. Every other command stays sandboxed, including the `lumo` commands that change local files or start local processes (`init`, `uninstall`, `update`, `auth`, `worktree`, `memory sync/push`, `session attach`, `task update`, `hook`) or can read a local file and upload it (`doc create/update/patch/append/diff`, `task artifact add`, `task template create/edit`, `task testcase run`, `crossing explain`, `milestone testcase run`, `usage resync`): Codex asks before running those outside the sandbox. Restart Codex to load it (a project rule loads once the project is trusted)
3. Adds the `prepare-commit-msg` git hook block
4. Prints any remaining steps (global install, `lumo auth login`)

No skill files are installed. At session start the hooks inject a short pointer; the agent loads the skill on demand with `lumo skill read` (and `lumo skill read references/<file>`), so it always matches the installed CLI.

For the commands Codex asks about (the local-file ones listed above), put global flags such as `--project` after the command words (`lumo memory sync --project x`); the other order is refused with a hint.

Non-interactive flags for CI / scripts:

```bash
npx @lumoai/cli init --dry-run            # preview, nothing written
npx @lumoai/cli init --agent codex        # only Codex
npx @lumoai/cli init --agent claude-code  # only Claude Code
```

After `init`, install the CLI globally so the agents' hooks can resolve the `lumo` binary at startup:

```bash
npm install -g @lumoai/cli
```

## Update

```bash
lumo update
```

Checks npm for a newer release and runs `npm install -g @lumoai/cli@latest` if one is available. The CLI also performs a background check once every 24 hours and prints a one-line notice on subsequent invocations when an upgrade is available.

Auto-update is on by default: the CLI installs new releases in the background. Turn it off with `lumo update --auto off` (back on with `lumo update --auto on`), or set `LUMO_NO_AUTO_UPDATE=1` in the environment. It is also off whenever `CI` is set (CI runs never self-update).

### Checking and removing a repo's setup

The skill guide ships inside the CLI (`lumo skill read`), so updating the CLI updates it; nothing is copied into your repo or home. After an upgrade the session start names any committed hook file that is behind — re-run `lumo init` in that repo (`--dry-run` previews the diff).

```bash
lumo doctor      # read-only report of this repo's hooks, Codex rule and git hook, plus login / API reachability
lumo uninstall   # remove the Lumo hook entries, the Codex rule and the git hook block from this repo
```

`lumo uninstall --agent <token>` filters by agent (`claude-code`, `codex`, …); the `prepare-commit-msg` hook is labelled `git`, so it is only included by `--agent git` (or no `--agent`).

## Authentication

```bash
lumo auth login
```

The CLI opens your browser to create an API key, then reads it from stdin. Keys are stored in `~/.lumo/credentials.json`.

Check who you're logged in as:

```bash
lumo whoami
# Logged in as you@example.com
#   Workspace: Acme (acme)
#   Key: My laptop (lum_abc1...)
#   API: https://www.uselumo.ai
```

## Quick Start

```bash
# What am I working on?
lumo task list

# Create a task
lumo task create "Fix Slack OAuth redirect" --priority high

# Mark it in progress
lumo task update LUM-42 --status in_progress

# Bind the current Claude Code session to the task
lumo session attach LUM-42

# Load full background (description, prior session summaries, memory)
lumo task context LUM-42

# When you're done
lumo task update LUM-42 --status done
```

## Commands

| Group       | Highlights                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `init`      | Install the Lumo hooks (Claude Code: 17 events, Codex: 9), the Codex rule and the git hook into this repo |
| `skill`     | `read [path]` prints the Lumo skill (SKILL.md or a `references/` file) shipped with the CLI               |
| `doctor`    | Read-only report of this repo's hooks, Codex rule and git hook, and whether they are current              |
| `uninstall` | Remove the Lumo hooks, the Codex rule and the git hook block from this repo                               |
| `auth`      | `login`, `logout`                                                                                         |
| `whoami`    | Show current identity + workspace                                                                         |
| `update`    | Self-update to the latest npm release; `--auto on\|off` toggles background updates                        |
| `task`      | `create`, `update`, `list`, `show`, `comment`, `context`                                                  |
| `session`   | `attach`, `status`, `detach` (binds Claude Code sessions)                                                 |
| `project`   | `list`                                                                                                    |
| `milestone` | `create`, `update`, `list`, `show`, `delete`                                                              |
| `sprint`    | `create`, `start`, `close`, `list`, `show`, `add`, `remove`, `summary`                                    |
| `doc`       | `create`, `update`, `list`, `show`, `move`, `bind`, `share`                                               |

Every command accepts `--help` for full flags and examples:

```bash
lumo task create --help
lumo sprint close --help
```

## Claude Code Integration

Inside a Claude Code session, the agent skill auto-discovers the CLI and uses it to load task context, bind sessions, and update task state. See the [Lumo Claude Code skill](https://github.com/Lumo-Workspace/lumo/tree/main/cli/skill) for the full agent contract.

## License

[MIT](LICENSE) © 2026 Lumo AI. The agent skill files bundled in `assets/skill` are covered by the same license.
