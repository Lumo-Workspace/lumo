# Feedback to the Lumo team

`lumo feedback` sends a bug report, an idea or a question **about Lumo itself** to the Lumo team, and shows the status and the team's replies. It never creates a task in your workspace. Every member of the workspace can list and read the workspace's reports; nobody else can (another workspace gets "not found").

### When to suggest / file it yourself

- Lumo itself misbehaves: the CLI crashes or prints something wrong, the server returns 5xx, an error gives no way forward, or this skill / `--help` says one thing and the command does another.
- You retried once (and ran `lumo doctor` for install problems) and it still fails.
- The user wants something Lumo cannot do (`--kind idea`), or the docs leave a question open (`--kind question`).

**Do not file** for bugs in the user's own project, for task content, for things `--help` or this skill already answer, or for a crossing / security finding (those have their own rulings).

**How**

- Run `lumo feedback list --mine` first; do not file the same problem twice.
- One problem per report. Steps are commands or UI actions, not your reasoning.
- **Never paste source code, diffs, transcripts or customer data** into the title, steps, expected or actual. Describe what happened and quote only the error line. Attach a screenshot or log only when it contains nothing else.
- You may file without asking the user, but say so in your reply and give the `FB-<n>` ref.
- Over the limit (exit 1, `--json` code `RATE_LIMITED`): stop, tell the user, add details to an existing report instead.

### `lumo feedback create --title <title> [flags]`

| Flag                     | Meaning                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `--title <title>`        | Required, ≤ 200 characters                                                                                    |
| `--kind <kind>`          | `bug` (default), `idea` or `question`, case-insensitive                                                       |
| `--step <text>`          | One step to reproduce; repeatable, kept in order; 0–30, each ≤ 500 characters                                 |
| `--expected <text>`      | What you expected (≤ 2000)                                                                                    |
| `--actual <text>`        | What happened — quote the error line (≤ 2000)                                                                 |
| `--evidence-file <path>` | Screenshot or log: png / jpeg / webp / gif / txt / log / json, ≤ 10 MB each, at most 5; repeatable            |
| `--task <ref>`           | A related task (`LUM-42`). Only the ref is sent; it must be a task of this workspace. Never filled in for you |
| `--no-env`               | Send no environment block and no session id                                                                   |
| `--json`                 | Print `{ version, feedback, replies }`                                                                        |

```bash
lumo feedback create --title "task testcase run: evidence upload fails with HTTP 413" \
  --step "lumo task testcase run LUM-42/TC1 --result pass --env local --evidence-file shot.png" \
  --expected "the run is recorded" --actual "Error: evidence upload failed (HTTP 413)" \
  --evidence-file shot.png --task LUM-42
lumo feedback create --kind idea --title "feedback list: filter by task"
lumo feedback create --title "doctor reports a stale hook" --no-env
```

**Environment block** (sent unless `--no-env`; the output's `Sent env:` line shows exactly what went): CLI version, OS name / release / architecture, Node version, which agent runs the CLI (from the presence of its session variable), and the **last `lumo` command of this session** — its command path, the **names** of the flags given and its exit code (within the last hour). Never a flag value, an argument, the working directory, the repository, the host or user name. The session id goes along as a ref only.

Text you write (title, steps, expected, actual) and text / JSON evidence files are scanned for credentials before saving; anything that looks like one is stored redacted and the output says `Note: N suspected secrets were redacted before saving.`

Output:

```
Created feedback FB-12 "task testcase run: evidence upload fails with HTTP 413"
Kind:     BUG
Status:   NEW
Evidence: 1 file
Task:     LUM-42
Sent env: cli 1.126.0 · darwin 24.2.0 arm64 · node 22.11.0 · claude-code · last: task testcase run (exit 1)
Hint: the Lumo team's replies show up in `lumo feedback show FB-12`.
```

**Limits** (per member: 5 per 10 minutes, 20 per rolling 24 h; per workspace: 20 per 10 minutes, 50 per rolling 24 h). Over a limit: exit 1,

```
Error: feedback limit reached for this workspace (50 per 24 h); you can send more after 2026-10-20 09:14 +08:00
Hint: add details to an existing report instead (`lumo feedback list --mine`); if this is urgent, tell the Lumo team directly.
```

Exit codes: 0 sent · 1 not sent (limit, auth, server, unreadable evidence file, task ref not in this workspace) · 2 invalid flag (kind, lengths, more than 5 files, file type, file over 10 MB).

### `lumo feedback list [flags]`

This workspace's reports, newest first: `-s, --status new|triaged|resolved|wontfix`, `--kind bug|idea|question`, `--mine` (only yours), `-n, --limit <n>` (default 50), `--cursor <c>`, `--json` → `{ version, feedback: [{ ref, id, kind, status, title, replyCount, submittedBy, createdAt }], total, nextCursor }`.

```
ID     KIND  STATUS   REPLIES  CREATED                  BY       TITLE
FB-12  BUG   TRIAGED        1  2026-10-19 10:02 +08:00  Chao Li  task testcase run: evidence upload fails with HTTP 413
```

Piped: TAB-separated, no header, times in UTC.

```bash
lumo feedback list --mine
lumo feedback list --status triaged --json
```

### `lumo feedback show <ref>`

One report (`FB-12` or `12`) with Kind, Status, who sent it, Steps, Expected, Actual, Evidence (file-route URLs, readable by this workspace only), the Environment block and the **Replies** of the Lumo team (signed `Lumo team`). A report of another workspace, or one that does not exist, is `Error: feedback FB-12 not found in workspace <slug>` (exit 1). `--json` → `{ version, feedback: { ref, id, kind, status, title, steps, expected, actual, evidence, environment, task, sessionId, submittedBy, secretsRedacted, createdAt, updatedAt, statusChangedAt }, replies: [{ body, author, createdAt }] }`.

```bash
lumo feedback show FB-12
```

Status values: `NEW` (not looked at yet), `TRIAGED` (the team has it), `RESOLVED`, `WONTFIX`.
