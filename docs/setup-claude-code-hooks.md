# Configure Claude Code to Record Events in Lumo

Once configured, every tool call (Read, Edit, Bash, etc.) and stop event
from your Claude Code sessions will be forwarded to your Lumo workspace.
This gives Lumo visibility into runtime activity — which files you read,
what commands you ran, when sessions ended.

## Prerequisites

- Lumo CLI installed and logged in: `lumo auth login`. Verify with
  `lumo whoami` — you should see your workspace and API key prefix.
- Claude Code installed.

## Step 1 — Add hooks to your Claude Code settings

Pick one of the following scopes:

- **Project scope (recommended for teams):** Edit `.claude/settings.json`
  in your project root. Check it into git so teammates share the same
  config.
- **User scope:** Edit `~/.claude/settings.json`. Applies to every
  project you open with Claude Code.

Merge this block into the file's `hooks` object:

```json
{
  "hooks": {
    "PreToolUse": [{ "type": "command", "command": "lumo hook pre-tool-use" }],
    "PostToolUse": [
      { "type": "command", "command": "lumo hook post-tool-use" }
    ],
    "PostToolUseFailure": [
      { "type": "command", "command": "lumo hook post-tool-use-failure" }
    ],
    "UserPromptSubmit": [
      { "type": "command", "command": "lumo hook user-prompt-submit" }
    ],
    "Stop": [{ "type": "command", "command": "lumo hook stop" }],
    "StopFailure": [{ "type": "command", "command": "lumo hook stop-failure" }],
    "PermissionRequest": [
      { "type": "command", "command": "lumo hook permission-request" }
    ],
    "PermissionDenied": [
      { "type": "command", "command": "lumo hook permission-denied" }
    ],
    "SessionStart": [
      { "type": "command", "command": "lumo hook session-start" }
    ],
    "SessionEnd": [{ "type": "command", "command": "lumo hook session-end" }],
    "SubagentStart": [
      { "type": "command", "command": "lumo hook subagent-start" }
    ],
    "SubagentStop": [
      { "type": "command", "command": "lumo hook subagent-stop" }
    ],
    "FileChanged": [{ "type": "command", "command": "lumo hook file-changed" }],
    "ConfigChange": [
      { "type": "command", "command": "lumo hook config-change" }
    ]
  }
}
```

If the file already has other hooks, add the Lumo entries alongside them
rather than replacing the whole block.

Do not add `WorktreeCreate` / `WorktreeRemove` entries for Lumo: a
`WorktreeCreate` hook replaces Claude Code's own `git worktree add` and must
print the new worktree's path, so a Lumo forwarder there makes
`claude --worktree` and worktree sessions fail. Older Lumo versions installed
them; re-running `lumo init` removes them, and `lumo doctor` flags any left.

## Step 2 — Try it

1. Open any project and run `claude` (or your usual Claude Code launcher).
2. Ask Claude Code to do something trivial: "Read the package.json".
3. In your Lumo workspace DB (or via the Lumo web UI, when wired up),
   check the `hook_events` table — you should see two rows per tool call
   (one `PRE_TOOL_USE`, one `POST_TOOL_USE`) plus a `STOP` when the
   session ends.

## Troubleshooting

Hooks are **silent by design**: failures never crash Claude Code. If
events aren't showing up in Lumo, check the local log:

```sh
tail -n 20 ~/.lumo/hook.log
```

Common entries and what they mean:

| Log entry                                                   | Cause                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `[pre-tool-use] no credentials; skipping`                   | `lumo auth login` wasn't run, or `~/.lumo/credentials.json` was deleted. Re-run login. |
| `[pre-tool-use] HTTP 401 from ...`                          | Your API key was revoked. Run `lumo auth login` again.                                 |
| `[pre-tool-use] HTTP 500 from ...`                          | Lumo server error. Check server logs — this one's on us.                               |
| `[pre-tool-use] request failed: fetch failed`               | Network / DNS issue, or Lumo API is down.                                              |
| `[pre-tool-use] request failed: The operation was aborted.` | Lumo API took more than 1s to respond — transient.                                     |

### Temporarily disabling hooks

Comment them out (JSON doesn't support `//` comments, so delete the
entries and re-add later) or run Claude Code from a directory without a
`.claude/settings.json`.

### Where hooks run

The `lumo hook` command reads credentials from `~/.lumo/credentials.json`
and POSTs to the API URL recorded there. If you want to point at a
different Lumo environment (staging, local dev), either re-run
`lumo auth login` against that environment or set `LUMO_API_URL` in the
shell that Claude Code inherits.

## What gets recorded

For each event we store:

- `type`: one of `PRE_TOOL_USE`, `POST_TOOL_USE`, `POST_TOOL_USE_FAILURE`,
  `USER_PROMPT_SUBMIT`, `STOP`, `STOP_FAILURE`, `PERMISSION_REQUEST`,
  `PERMISSION_DENIED`, `SESSION_START`, `SESSION_END`, `SUBAGENT_START`,
  `SUBAGENT_STOP`, `WORKTREE_CREATE`, `WORKTREE_REMOVE`, `FILE_CHANGED`,
  `CONFIG_CHANGE`
- `toolName`: the tool Claude Code called (Read, Edit, Bash, ...)
- `payload`: the raw hook body Claude Code sent (including file paths,
  tool inputs, etc.)
- `createdAt`, `workspaceId`, `workspaceMemberId`

Payloads are stored verbatim. If that's a concern for your workspace,
talk to your admin before enabling this.
