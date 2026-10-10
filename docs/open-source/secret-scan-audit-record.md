# Secret audit record (LUM-1015, private)

Private-repository record split out of `secret-scan.md`. It names private
history commits, `.env.production` locations, and the owner's rotation
attestation, so `oss/manifest.json` excludes it (together with
`historical-credential-rotations.json`) from the public snapshot.

## Private-history reviewed matches

The historical private-key match in
`docs/superpowers/plans/2026-06-01-integration-team-modeling-github-app.md:417`
at `7d92022675` spans example PEM markers with 9/23-character placeholder bodies,
not a parseable private key. Older Google-auth requirement examples use prose
placeholders, not issued Google credentials. Database URLs outside the known
production file are documented placeholders or local/test connection defaults.
The default Gitleaks rules alone missed the known historical Neon URLs, which is
why the audit adds a database-URL password rule.

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
