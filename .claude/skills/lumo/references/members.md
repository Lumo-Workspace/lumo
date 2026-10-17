# Members

### `lumo member list [--json]` — the workspace member directory (LUM-821)

Lists every workspace member as `name  email  ROLE` (on a TTY aligned by display width under a `NAME  EMAIL  ROLE` header; piped, TAB-separated with no header), then the agent actors. These are exactly the refs `--assignee` accepts on `task create`, `task update` and `task search` (`me`, an email, a member name; `task search` also takes an agent name or `none`).

```bash
lumo member list
lumo member list --json
```

```
Alice Chen  alice@example.com  OWNER
Bob         bob@example.com    MEMBER

Agents:
  Claude Code  (CODING)
```

`--json` prints `{ version, members: [{ memberId, displayName, email, actorId, role, clerkId }], agents: [{ actorId, name, type }], total, nextCursor }` (`total` counts members; `clerkId` is deprecated — still emitted, listed in `deprecatedFields: ["clerkId"]`, removed only with a `version` bump) — `actorId` is what tasks store as their assignee.

### When to suggest `member list`

- Before assigning a task when the user names someone ambiguously ("give it to Bob") — check the exact name/email first.
- "Who is in this workspace", "who can I assign this to".
