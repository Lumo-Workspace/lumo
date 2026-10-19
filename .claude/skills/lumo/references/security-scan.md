# Local security scans — `lumo security scan`

`lumo security scan` runs Lumo's security scanners **on this machine, on your uncommitted and unpushed changes**, so a problem is caught before it reaches a PR. It is read-only: nothing is uploaded, nothing is written, no task or finding changes. The PR scan stays the only authority for DONE — a clean local scan never clears a gate, and a local finding never blocks one.

Scanners today: `SECRETS` (`--secrets`). With no scanner flag, every local scanner runs.

## What `SECRETS` checks

The **same deterministic secret scanner as the PR scan's first stage** (the code lives in `shared/src/secret-scan/`; the server imports the identical module), over the lines your changes add. No network, no binary, typically well under a second. Findings carry the server's fingerprints, so a local finding is the same finding the PR scan will report.

## Flags

| Flag                   | Notes                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--secrets`            | Run the secret scanner. No scanner flag = every local scanner.                                                                                                                                            |
| _(no scope flag)_      | From the merge-base with the default branch (`origin/HEAD`, else `origin/main` / `origin/master`) to the **working tree**: committed, staged and unstaged edits, plus untracked files (not ignored ones). |
| `--staged`             | Only the index (`git diff --cached`) — what the next commit will contain. For a pre-commit hook. Untracked files are not read.                                                                            |
| `--since <ref>`        | From `<ref>` (as given, not its merge-base) to the working tree, untracked files included. Not with `--staged`.                                                                                           |
| `--fail-on <severity>` | `low` \| `medium` \| `high` (case-insensitive): exit **3** when any finding is at or above it.                                                                                                            |
| `--json`               | The list envelope (below).                                                                                                                                                                                |

```bash
lumo security scan
lumo security scan --secrets --staged --fail-on high
lumo security scan --since origin/main --json
```

Run it from anywhere inside the repository; paths are repo-relative. Untracked files that are binary, symlinks, unreadable or over 2 MiB are skipped and listed on a `Skipped …` line.

## Output

```
scan: 1 finding (1 high, 0 medium, 0 low)
Scope: SECRETS · origin/main (merge-base 1a2b3c4) → working tree · 6 files · 41ms

  • [HIGH] AWS access key ID
    Rule:      secret:aws-access-key-id
    Where:     src/config.ts:2
    Evidence:  export const key = "AKIA…(len 20)"
```

- **Line 1 is the parseable summary**, the same shape whichever scanners ran.
- Evidence is the scanner's **redacted** line; the raw value is never printed, in text or `--json`.
- A finding the scanner lowered to LOW says why (`— placeholder value, downgraded`, `— test/fixture/doc path, downgraded`).
- No server context yet: the output does not know what is already on main, ruled a false positive, or covered by a learning.

### `--json`

`{ version: 1, findings: [...], total, nextCursor: null, scanners, scope, filesScanned, skipped, elapsedMs, summary }` — `summary` is `{ total, high, medium, low }`; `scanners` lists the enums that ran (`SECRETS`). Declared finding fields: `scanner`, `kind` (`SECRET`), `ruleId`, `severity` (`LOW|MEDIUM|HIGH`), `title`, `filePath`, `line`, `evidence` (redacted), `fingerprint` (the server's), `detail`, `downgrade` (`PLACEHOLDER_VALUE` | `DOWNGRADED_PATH` | `null`).

## Exit codes

| Code | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | The scan ran (findings or not) and `--fail-on` was not given or not met               |
| 1    | Failed: not a git repo, unknown `--since` ref, no default branch found                |
| 2    | Usage error: `--staged` with `--since`, an invalid `--fail-on` value                  |
| 3    | `--fail-on` met — distinct from 1 and 2 so a hook can block on findings yet fail open |

4 and 5 stay the confirmation and DONE gates' codes ([confirmation.md](confirmation.md)).

## When to suggest

- Before pushing or opening a PR — "check my changes for secrets", "did I leave a key in here?".
- After writing config, `.env`-style files, test fixtures or scripts that might hold a credential.
- In a pre-commit hook: `lumo security scan --staged --fail-on high`.
- Not for reading what the PR scan found — that is `lumo pr show <number>` ([pr-scan.md](pr-scan.md)).
