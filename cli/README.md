# Lumo CLI

Manage [Lumo](https://www.uselumo.ai) tasks, sessions, sprints, and documents from the terminal. Designed to pair with Claude Code so AI agents can bind to a task, load context, and update state without leaving the shell.

## Install

```bash
npm install -g @lumoai/cli
```

Verify:

```bash
lumo --version
```

## One-Shot Setup for Claude Code

If you use [Claude Code](https://claude.com/claude-code), wire up the Lumo skill + hooks in one command — no install required upfront:

```bash
npx @lumoai/cli setup
```

The command interactively asks whether to install for the current user (`~/.claude/`) or just the current project (`./.claude/`), then:

1. Drops the skill files (`SKILL.md` + `references/`) into `.claude/skills/lumo/`
2. Idempotently merges 25 Lumo hook handlers into `.claude/settings.json` (existing hooks and permissions are preserved)
3. Prints any remaining steps (global install, `lumo auth login`)

Non-interactive flags for CI / scripts:

```bash
npx @lumoai/cli setup --project
npx @lumoai/cli setup --user --force
```

After `setup`, install the CLI globally so Claude Code's hooks can resolve the `lumo` binary at startup:

```bash
npm install -g @lumoai/cli
```

## Update

```bash
lumo update
```

Checks npm for a newer release and runs `npm install -g @lumoai/cli@latest` if one is available. The CLI also performs a background check once every 24 hours and prints a one-line notice on subsequent invocations when an upgrade is available.

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

| Group       | Highlights                                                                             |
| ----------- | -------------------------------------------------------------------------------------- |
| `setup`     | Install skill files (SKILL.md + references/) + hooks into `~/.claude/` or `./.claude/` |
| `auth`      | `login`, `logout`                                                                      |
| `whoami`    | Show current identity + workspace                                                      |
| `update`    | Self-update to the latest npm release                                                  |
| `task`      | `create`, `update`, `list`, `show`, `comment`, `context`                               |
| `session`   | `attach`, `status`, `detach` (binds Claude Code sessions)                              |
| `project`   | `list`                                                                                 |
| `milestone` | `create`, `update`, `list`, `show`, `delete`                                           |
| `sprint`    | `create`, `start`, `close`, `list`, `show`, `add`, `remove`, `summary`                 |
| `doc`       | `create`, `update`, `list`, `show`, `move`, `bind`, `share`                            |

Every command accepts `--help` for full flags and examples:

```bash
lumo task create --help
lumo sprint close --help
```

## Claude Code Integration

Inside a Claude Code session, the agent skill auto-discovers the CLI and uses it to load task context, bind sessions, and update task state. See the [Lumo Claude Code skill](https://github.com/Lumo-Workspace/lumo/tree/main/.claude/skills/lumo) for the full agent contract.

## License

[MIT](LICENSE) © 2026 Lumo AI. The agent skill files bundled in `assets/skill` are covered by the same license.
