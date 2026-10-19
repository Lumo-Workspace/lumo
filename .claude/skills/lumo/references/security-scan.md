# Local security scans — `lumo security scan`

`lumo security scan` runs Lumo's security scanners **on this machine, on your uncommitted and unpushed changes**, so a problem is caught before it reaches a PR. It is read-only: nothing is uploaded, nothing is written, no task or finding changes. The PR scan stays the only authority for DONE — a clean local scan never clears a gate, and a local finding never blocks one.

Scanners today: `SECRETS` (`--secrets`) and `DEPS` (`--deps`). With no scanner flag, every local scanner runs.

## What `SECRETS` checks

The **same deterministic secret scanner as the PR scan's first stage** (the code lives in `shared/src/secret-scan/`; the server imports the identical module), over the lines your changes add. No network, no binary, typically well under a second. Findings carry the server's fingerprints, so a local finding is the same finding the PR scan will report.

## What `DEPS` checks

Known-vulnerable and **known-malicious** dependencies, with the managed PR scan's identity (osv-scanner's advisory ids; rule `ext:osv-scanner:<id>`, the server's dependency fingerprint).

- **Fast (default)** — diffs every npm `package-lock.json` / `npm-shrinkwrap.json` between the scope's base and head, and looks up **only the added or re-versioned packages** on the OSV API. No binary; typically under a second when nothing changed, a few seconds for a whole lockfile. Other ecosystems' lockfiles (`yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `requirements.txt`, …) are not read in fast mode: a changed one is listed on a `Not checked …` line — use `--full`.
- **`--full`** — runs **osv-scanner from your PATH** (`osv-scanner scan source -r . --format json`) over the whole working tree, every ecosystem, pre-existing debt included (`--staged` / `--since` do not narrow it). If osv-scanner is not installed it exits 1 with install instructions (`brew install osv-scanner`, `go install …`, release binaries). Lumo never downloads a binary.
- **`--offline`** — no network call: osv-scanner's local database instead of the API (fast mode runs it on the changed lockfiles and keeps the changed packages). Needs osv-scanner and its database (`osv-scanner scan source --offline-vulnerabilities --download-offline-databases -r .` fetches it once).
- **Privacy:** fast mode sends **package names, versions and the ecosystem** to `api.osv.dev` (Google's OSV service) — nothing else: no code, paths or repository name. Use `--offline` when that is not acceptable.
- **`MAL-*` advisories (known-malicious packages) are always HIGH** and get their own `MALICIOUS: …` line; remove the package and rotate any credential it could have read.
- Each finding suggests the **fixed version** (the lowest release that fixes every advisory in its group), or says none is published.
- **`osv-scanner.toml` ignores are honoured**, by id or alias, from the file next to each lockfile (as osv-scanner reads it): suppressed advisories are listed on an `Ignored by osv-scanner.toml: …` line. Once an entry's `ignoreUntil` passes, the advisory is reported again with `— osv-scanner.toml ignore expired <date>`.
- Severity: `MAL-*` HIGH; else the CVSS v3 base score (≥7 HIGH, ≥4 MEDIUM, else LOW, as the PR scan maps it); else the advisory's own label; else MEDIUM.
- **Incomplete, never clean:** when the OSV API is unreachable, times out (10 s per request) or answers badly — or a lockfile is not valid JSON — line 1 ends `· incomplete: DEPS`, an `Incomplete: DEPS — …` line says why, and the exit code is 1.

## Flags

| Flag                   | Notes                                                                                                                                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--secrets`            | Run the secret scanner. No scanner flag = every local scanner.                                                                                                                                            |
| `--deps`               | Run the dependency scanner (fast mode). Sends changed package names and versions to `api.osv.dev`.                                                                                                        |
| `--full`               | `DEPS` runs osv-scanner from PATH over the whole tree instead of the lockfile delta. Not with `--secrets` alone (exit 2).                                                                                 |
| `--offline`            | No network call: `DEPS` uses osv-scanner's local database. Not with `--secrets` alone (exit 2).                                                                                                           |
| _(no scope flag)_      | From the merge-base with the default branch (`origin/HEAD`, else `origin/main` / `origin/master`) to the **working tree**: committed, staged and unstaged edits, plus untracked files (not ignored ones). |
| `--staged`             | Only the index (`git diff --cached`) — what the next commit will contain. For a pre-commit hook. Untracked files are not read.                                                                            |
| `--since <ref>`        | From `<ref>` (as given, not its merge-base) to the working tree, untracked files included. Not with `--staged`.                                                                                           |
| `--fail-on <severity>` | `low` \| `medium` \| `high` (case-insensitive): exit **3** when any finding is at or above it.                                                                                                            |
| `--json`               | The list envelope (below).                                                                                                                                                                                |

```bash
lumo security scan
lumo security scan --secrets --staged --fail-on high
lumo security scan --since origin/main --json
lumo security scan --deps --fail-on high
lumo security scan --deps --full
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
- With `DEPS`, a `Deps: …` line says what was checked and against what (`2 added or changed packages in package-lock.json checked against api.osv.dev`, or `osv-scanner, whole tree`); a DEPS finding shows `Package`, `Where` (the lockfile), `Fix` and `Advisory` (its osv.dev page) instead of a line and evidence.

```
scan: 1 finding (1 high, 0 medium, 0 low)
Scope: SECRETS, DEPS · origin/main (merge-base 1a2b3c4) → working tree · 3 files · 412ms
Deps: 2 added or changed packages in package-lock.json checked against api.osv.dev

  • [HIGH] Command Injection in lodash
    Rule:      ext:osv-scanner:GHSA-35jh-r3h4-6jhm
    Package:   lodash@4.17.15 (npm)
    Where:     package-lock.json
    Fix:       upgrade to 4.17.21 or later
    Advisory:  https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm
```

- No server context yet: the output does not know what is already on main, ruled a false positive, or covered by a learning.

### `--json`

`{ version: 1, findings: [...], total, nextCursor: null, scanners, scope, filesScanned, skipped, elapsedMs, summary, complete, incomplete, deps }` — `summary` is `{ total, high, medium, low }`; `scanners` lists the enums that ran (`SECRETS`, `DEPS`); `complete` is false when any scanner could not finish, and `incomplete` lists `{ scanner, reason }`; `deps` is `{ mode: fast|full, source, lockfiles, packagesChecked, ignored[], notCovered[] }` or `null` when DEPS did not run. Declared finding fields: `scanner`, `kind` (`SECRET` | `DEPENDENCY`), `ruleId`, `severity` (`LOW|MEDIUM|HIGH`), `title`, `filePath`, `line` (`null` for DEPENDENCY), `evidence` (redacted; `null` for DEPENDENCY), `fingerprint` (the server's), `detail`, `downgrade` (`PLACEHOLDER_VALUE` | `DOWNGRADED_PATH` | `null`). A DEPENDENCY finding adds `dependency: { ecosystem, name, version, osvId, aliases, malicious, fixedVersion, score, url, ignoreExpired }`.

## Exit codes

| Code | Meaning                                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | The scan ran (findings or not) and `--fail-on` was not given or not met                                                                                                                                                                  |
| 1    | Failed: not a git repo, unknown `--since` ref, no default branch found; osv-scanner missing for `--full` / `--offline`; or a scanner could not finish (`DEPS` with the OSV API unreachable) — the report still prints, marked incomplete |
| 2    | Usage error: `--staged` with `--since`, an invalid `--fail-on` value, `--full` / `--offline` without `DEPS`                                                                                                                              |
| 3    | `--fail-on` met — distinct from 1 and 2 so a hook can block on findings yet fail open                                                                                                                                                    |

4 and 5 stay the confirmation and DONE gates' codes ([confirmation.md](confirmation.md)).

## When to suggest

- Before pushing or opening a PR — "check my changes for secrets", "did I leave a key in here?".
- After writing config, `.env`-style files, test fixtures or scripts that might hold a credential.
- In a pre-commit hook: `lumo security scan --staged --fail-on high`.
- After `npm install` / a dependency bump, or before pushing a lockfile change — "did that upgrade pull in anything vulnerable?": `lumo security scan --deps`.
- For the whole tree or a non-npm project: `lumo security scan --deps --full` (needs osv-scanner on PATH).
- Not for reading what the PR scan found — that is `lumo pr show <number>` ([pr-scan.md](pr-scan.md)).
