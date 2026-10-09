# Secret audit (LUM-1015)

## Re-run before publishing

Install [Gitleaks 8.30.1](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1).
The audit uses its default rules plus a database-URL password rule: the default
rules alone missed the known historical Neon URLs.

```sh
python3 scripts/audit-secrets.py snapshot --ref HEAD --report /tmp/lumo-snapshot-audit.json
git fetch origin --prune --tags
python3 scripts/audit-secrets.py history --report /tmp/lumo-history-audit.json
```

Use `--gitleaks-bin /path/to/gitleaks` if the binary is outside PATH. This is a
trusted local executable chosen by the operator, never by scanned content.
Exit 0 means no unresolved
matches; exit 1 means at least one match needs review or rotation evidence.
Tool failures also exit nonzero and report the exit code, report presence, and
a fixed diagnostic category without reproducing source text or scanner logs.
Internally the scanner reserves exit 3 for detected findings; exit 1 is a tool
failure, even if a partial report exists. An explicitly created empty ignore
file prevents repository `.gitleaksignore` entries from suppressing audit matches.
Findings whose source blob cannot be read remain explicitly unresolved in the
report, with exception/rotation matching disabled for those findings.
Snapshot mode reads every tracked blob directly from the specified commit,
so untracked files, ignored production env files, and node_modules are excluded.
Re-run on the actual final public-release commit; this audit does not certify
future commits or the entire working directory.
`export-ignore`, `export-subst`, and checkout filters cannot exclude or alter
scanned content. Symlink target text is scanned without following the link;
submodules are refused rather than silently omitted. Non-UTF-8 source bytes are
preserved when checking exact-content exceptions.
Case-folding and Unicode-normalization path collisions are refused before any
snapshot file is written, including collisions between directory prefixes.

The added URL rule covers PostgreSQL, MySQL, MariaDB, MongoDB, Redis, SQL Server,
and CockroachDB, including driver-qualified schemes such as `mysql+pymysql`.
Empty usernames are supported (for example Redis password-only URLs).
Other connection formats (for example SQL Server semicolon connection strings)
are not covered by this extra rule; there is no universal credential-format guarantee.

History mode scans all locally available refs with `--all --full-history` and
refuses shallow clones. Fetch every relevant remote first. Unreachable/dangling
objects, server-only refs that were never fetched, and credentials stored outside
Git are outside this scan. Pattern matching cannot prove that every possible
credential format has been detected. The scanner never uses a credential to log
in or contacts the issuing service.

Only locations, rule names, and dispositions are written to the output report.
Gitleaks runs with full redaction; its intermediate report is temporary and is
deleted when the command exits. Do not publish raw scanner matches or credential
values in tasks, PRs, or logs.

## Reviewed exceptions

`secret-scan-false-positives.json` records reviewed synthetic test fixtures,
documentation placeholders, and local-development defaults. Exceptions require
the same file, rule, reviewed line span, and SHA-256 of the exact matched bytes.
LF alone defines line boundaries, preserving CR and non-UTF-8 bytes. There is no
blanket exemption for tests, docs, or env templates. Changed matched content
requires another review, including movement to an unreviewed line span.

Security fixtures contain deliberately recognizable fake AWS, Stripe, Twilio,
GitHub, JWT, and generic tokens, paired with scanner/masking assertions. Historical
auth tests contain explicit test secrets. The historical private-key match in
`docs/superpowers/plans/2026-06-01-integration-team-modeling-github-app.md:417`
at `7d92022675` spans example PEM markers with 9/23-character placeholder bodies,
not a parseable private key. Older Google-auth requirement examples use prose
placeholders, not issued Google credentials. Database URLs outside the known
production file are documented placeholders or local/test connection defaults.

## Audit recorded on 2026-10-10

Snapshot: `b51df3715e7c6889a90dae77ca764a9847151d49` (origin/main at audit time).
Private history: 2,859 reachable commits across local refs after fetching origin
branches/tags; repository is not shallow.

| Scope            | Matches | Reviewed false positives | Confirmed rotated | Unresolved |
| ---------------- | ------: | -----------------------: | ----------------: | ---------: |
| Tracked snapshot |     122 |                      122 |                 0 |          0 |
| Private history  |     177 |                      175 |                 2 |          0 |

The table contains occurrence counts from completed scans, not inventory row
counts. The inventory has 149 distinct file/rule/content exceptions, each with
reviewed line spans; an exception can cover repeated occurrences in the snapshot
and historical commits. Rotation attestations are two separate ledger entries.

No production credential was found in the scanned snapshot. The two historical
findings remain in reports with a `confirmed-rotated` disposition, separate from
false positives. The rotation ledger matches only the immutable historical
commit, file, line/column span, and rule, and only in history mode; it cannot exempt a
new occurrence in a release snapshot.

| Historical location                  | Credential                                 | Recorded rotation evidence                          |
| ------------------------------------ | ------------------------------------------ | --------------------------------------------------- |
| `.env.production:12` at `e4f0147ee1` | Neon pooled DATABASE_URL password          | Owner confirmed rotation in this chat on 2026-10-10 |
| `.env.production:13` at `e4f0147ee1` | Neon direct DATABASE_URL_UNPOOLED password | Owner confirmed rotation in this chat on 2026-10-10 |

The file was tracked from `e4f0147ee` (2026-03-28) until deletion at `addc08016`
(2026-06-25). The task's 2026-10-08 investigation reports that both historical
passwords differ from the local env file updated on 2026-06-26, and that LUM-593
is DONE with a commit stating the exposed credentials were rotated. This is
indirect evidence, not an independently checked Neon reset record. On 2026-10-10
the owner answered “I can confirm it was rotated” when asked to confirm a reset
after 2026-06-25. This owner attestation is recorded in
`historical-credential-rotations.json` for both occurrences. The exact reset date
was not provided, and the audit did not independently inspect the Neon console
or attempt a login. Re-run the snapshot scan on the final public-release commit.

Per the task's 2026-10-06 decision, publish a clean snapshot into the new public
repository. Do not rewrite the private Git history. The release snapshot audit
and private-history rotation audit remain separate checks.

Regression check: `python3 scripts/test-audit-secrets.py` uses a disposable Git
repository to verify exact fixture exceptions, changed fixture rejection,
database URL detection, metadata-only reports, and deleted-credential detection.
It also verifies export-ignore coverage, non-UTF-8 source handling, rotation-ledger
matching (and rejection of mismatched metadata), driver-qualified URL schemes,
safe failure diagnostics, symlink target blobs, missing commit rejection,
relocated fixtures, and LF-only line boundaries. Test fixtures are self-contained
and do not depend on unrelated tests in the live repository.
