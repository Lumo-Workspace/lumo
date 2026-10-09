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

Wire up the Lumo skill + hooks for [Claude Code](https://claude.com/claude-code) and [Codex](https://developers.openai.com/codex) in one command — no install required upfront:

```bash
npx @lumoai/cli init
```

The command interactively asks whether to install for the current user (`~/.claude/`, `~/.agents/`, `~/.codex/`) or just the current project (`./.claude/`, `./.agents/`, `./.codex/`), then:

1. Drops the skill files (`SKILL.md` + `references/`) into `.claude/skills/lumo/` (Claude Code) and `.agents/skills/lumo/` (Codex)
2. Idempotently merges the Lumo hook handlers into `.claude/settings.json` and `.codex/hooks.json` (existing hooks and permissions are preserved). Codex runs hooks only after you trust them: Codex app Settings → Hooks, or `/hooks` in the Codex CLI
3. Writes `.codex/rules/lumo.rules`, Codex rules that let the server-only `lumo` commands (they only call the Lumo API, read no arbitrary local file and write none — `task show/context/list`, `doc show/list`, `session status`, …) run outside Codex's sandbox (which has no network) without a prompt. Every other command stays sandboxed, including the `lumo` commands that change local files or start local processes (`init`, `uninstall`, `update`, `auth`, `worktree`, `memory sync/push`, `session attach`, `task update`, `hook`) or can read a local file and upload it (`doc create/update/patch/append/diff`, `task artifact add`, `task template create/edit`, `task testcase run`, `crossing explain`, `milestone criteria set`, `usage resync`): Codex asks before running those outside the sandbox. Restart Codex to load it (a project rule loads once the project is trusted)
4. Prints any remaining steps (global install, `lumo auth login`)

Non-interactive flags for CI / scripts:

```bash
npx @lumoai/cli init --project
npx @lumoai/cli init --user --force
npx @lumoai/cli init --project --agent codex        # only Codex
npx @lumoai/cli init --project --agent claude-code  # only Claude Code
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

### Keeping installs in sync

User-scope installs (`~/.claude/`, `~/.agents/`) are synced automatically after the CLI upgrades. Project-scope and git-tracked files are never auto-written, modified copies are never overwritten, and the CLI never downgrades an install that is newer than itself. Run `lumo init --upgrade` to refresh every known install by hand.

```bash
lumo doctor      # read-only report of every Lumo install and its state
lumo uninstall   # remove Lumo-owned skills, hooks, the Codex rule and the git hook block
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

| Group       | Highlights                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------ |
| `init`      | Install skill files (SKILL.md + references/) + hooks into `~/.claude/` or `./.claude/`     |
| `doctor`    | Read-only report of every Lumo install (skills, hooks, git hook) and whether it is current |
| `uninstall` | Remove Lumo-owned skills, hooks and the git hook block                                     |
| `auth`      | `login`, `logout`                                                                          |
| `whoami`    | Show current identity + workspace                                                          |
| `update`    | Self-update to the latest npm release; `--auto on\|off` toggles background updates         |
| `task`      | `create`, `update`, `list`, `show`, `comment`, `context`                                   |
| `session`   | `attach`, `status`, `detach` (binds Claude Code sessions)                                  |
| `project`   | `list`                                                                                     |
| `milestone` | `create`, `update`, `list`, `show`, `delete`                                               |
| `sprint`    | `create`, `start`, `close`, `list`, `show`, `add`, `remove`, `summary`                     |
| `doc`       | `create`, `update`, `list`, `show`, `move`, `bind`, `share`                                |

Every command accepts `--help` for full flags and examples:

```bash
lumo task create --help
lumo sprint close --help
```

## Claude Code Integration

Inside a Claude Code session, the agent skill auto-discovers the CLI and uses it to load task context, bind sessions, and update task state. See the [Lumo Claude Code skill](https://github.com/Lumo-Workspace/lumo/tree/main/.claude/skills/lumo) for the full agent contract.

## License

[MIT](LICENSE) © 2026 Lumo AI. The agent skill files bundled in `assets/skill` are covered by the same license.
