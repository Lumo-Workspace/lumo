# Local scans — `lumo scan`

`lumo scan` runs Lumo's security scans **on this machine, on your uncommitted and unpushed changes**, so a problem is caught before it reaches a PR (LUM-1255). It is read-only: nothing is uploaded, nothing is written, no task or finding changes. The PR scan stays the only authority for DONE — a clean local scan never clears a gate, and a local finding never blocks one.

Today the family has one scanner, `secrets`.

## `lumo scan secrets`

Runs the **same deterministic secret scanner as the PR scan's first stage** (the code lives in `shared/src/secret-scan/`; the server imports the identical module) over the lines your changes add. No network, no binary, typically well under a second. Findings carry the server's fingerprints, so a local finding is the same finding the PR scan will report.

| Flag                   | Notes                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _(none)_               | From the merge-base with the default branch (`origin/HEAD`, else `origin/main` / `origin/master`) to the **working tree**: committed, staged and unstaged edits, plus untracked files (not ignored ones). |
| `--staged`             | Only the index (`git diff --cached`) — what the next commit will contain. For a pre-commit hook. Untracked files are not read.                                                                            |
| `--since <ref>`        | From `<ref>` (as given, not its merge-base) to the working tree, untracked files included. Not with `--staged`.                                                                                           |
| `--json`               | Versioned payload: `{ version: 1, scanner, scope, filesScanned, skipped[], elapsedMs, summary, findings[] }`.                                                                                             |
| `--fail-on <severity>` | `low` \| `medium` \| `high`: exit **3** when any finding is at or above it.                                                                                                                               |

```bash
lumo scan secrets
lumo scan secrets --staged --fail-on high
lumo scan secrets --since origin/main --json
```

Run it from anywhere inside the repository; paths are repo-relative. Untracked files that are binary, symlinks or over 2 MiB are skipped and listed on a `Skipped …` line.

### Output

```
scan: 1 finding (1 high, 0 medium, 0 low)
Scope: secrets · origin/main (merge-base 1a2b3c4) → working tree · 6 files · 41ms

  • [HIGH] AWS access key ID
    Rule:      secret:aws-access-key-id
    Where:     src/config.ts:2
    Evidence:  export const key = "AKIA…(len 20)"
```

- **Line 1 is the parseable summary** — same shape for every `lumo scan` scanner.
- Evidence is the scanner's **redacted** line; the raw value is never printed, in text or `--json`.
- A finding the scanner lowered to LOW says why (`— placeholder value, downgraded`, `— test/fixture/doc path, downgraded`).
- No server context yet: the output does not know what is already on main, ruled a false positive, or covered by a learning.

### Exit codes

| Code | Meaning                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------- |
| 0    | Scan ran (findings or not), and `--fail-on` was not given or not met                            |
| 1    | Error: not a git repo, unknown `--since` ref, no default branch found, invalid flag combination |
| 3    | `--fail-on` met — distinct from 1 so a hook can block on findings yet fail open on errors       |

4 and 5 stay reserved for the confirmation and DONE gates ([confirmation.md](confirmation.md)).

### When to suggest

- Before pushing or opening a PR — "check my changes for secrets", "did I leave a key in here?", "/lumo scan".
- After writing config, `.env`-style files, test fixtures or scripts that might hold a credential.
- In a pre-commit hook: `lumo scan secrets --staged --fail-on high`.
- Not for reading what the PR scan found — that is `lumo pr scan <number>` ([pr-scan.md](pr-scan.md)).
