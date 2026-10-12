# Members

### `lumo member list [--json]` — the workspace member directory (LUM-821)

Lists every workspace member as `name  email  ROLE` (aligned by display width; on a TTY a `NAME  EMAIL  ROLE` header comes first, piped output has none), then the agent actors. These are exactly the refs `--assignee` accepts on `task create`, `task update` and `task search` (`me`, an email, a member name; `task search` also takes an agent name or `none`).

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

`--json` prints `{ members: [{ memberId, displayName, email, actorId, role }], agents: [{ actorId, name, type }] }` — `actorId` is what tasks store as their assignee.

### When to suggest `member list`

- Before assigning a task when the user names someone ambiguously ("give it to Bob") — check the exact name/email first.
- "Who is in this workspace", "who can I assign this to".
