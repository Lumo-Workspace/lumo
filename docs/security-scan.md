# Security scan

Lumo runs semgrep, gitleaks, osv-scanner, zizmor and trivy itself for every
pull request of a repository the GitHub App is installed on — no workflow
file, no secret, no GitHub Actions minutes, and no GitHub Advanced Security
are required. zizmor audits GitHub Actions workflows (template injection,
`pull_request_target` misuse, persisted credentials, unpinned actions) and
runs offline: it never calls the GitHub API, so no token is handed to it and
no action reference leaves the sandbox. `trivy config` checks Dockerfiles,
Kubernetes manifests, Helm charts, Terraform and CloudFormation for
misconfigurations of MEDIUM severity and above; it downloads trivy's public
check bundle, and nothing from the repository leaves the sandbox. semgrep
loads the registry packs plus Lumo's own rules for LLM-specific defects
(`security/semgrep-rules/`: request input reaching a prompt unparsed, a system
prompt built from runtime values), and the diff subgraph is checked for a model
result that reaches raw SQL, a shell, `eval`, a file write or `fetch` with no
schema parse in between — reported deterministically, without a model. The
PR's head commit is shallow-cloned into a one-shot Vercel Sandbox microVM
owned by Lumo (the same vendor that hosts the app), scanned, and the VM is
destroyed; only findings on lines the PR added are kept, redacted, and
nothing else from the repository is stored. Results show up in three places:
the task's security panel, a review on the pull request itself (one summary
comment plus inline comments on the affected lines, deduplicated across
re-scans), and `lumo task status`, which prints one line per PR with each
scan layer's state and any scanner failure reason.

**Sandbox isolation.** The clone token is minted for that one repository
with `contents: read` only, and revoked (`DELETE /installation/token`) as
soon as the clone is done. Before any scanner reads the checkout, Lumo
proves the token is not readable anywhere in the VM (`.git/config`, the
command environment, `~/.git-credentials`, `~/.netrc`, `~/.gitconfig`) and
refuses to scan if it cannot. Scanners are downloaded first; after that the
VM can reach only `semgrep.dev`, `api.osv.dev` and `api.deps.dev` while the
scanners run, and nothing at all while the AI hunt reads the code.

**Dependencies.** osv-scanner reads the repository's lockfiles and manifests
inside that same sandbox and queries the public [osv.dev](https://osv.dev)
API for known advisories — package names and versions leave the sandbox for
that lookup, nothing else. A vulnerable dependency has no "line the PR added",
so Lumo keeps a per-repository baseline instead: the fingerprint set of the
default branch's last scan, refreshed on every push to that branch (and built
lazily the first time a PR is scanned). A dependency finding already in the
baseline is shown muted as _already on the default branch_; only the ones a
PR introduces count as open. Dependency findings are advisory and never block
a task from reaching Done.

**Bring your own scanner (optional).** Teams that want their own tools or
rule sets can push SARIF to `POST /api/integrations/security/sarif/upload` +
`/complete` from any CI, authenticated with a GitHub Actions OIDC token or a
CI ingest key. No secret is required from a GitHub Actions workflow: it
requests its own OIDC ID token (`permissions.id-token: write`) and Lumo
verifies that token's `repository` and `ref` claims to authenticate the push;
a CI ingest key (Lumo → Settings → API keys, sent as `LUMO_SECURITY_TOKEN`) is
the fallback for CI systems other than GitHub Actions. This path runs in the
customer's own CI and consumes their Actions minutes — Lumo's managed scan
above does not. Each scanner job gzips its SARIF report and uploads it
directly to a private Vercel Blob, then tells Lumo the report is ready to
fetch. Diff-aware filtering — keeping only the lines the PR actually added —
happens on Lumo's side after ingest. The blob is deleted once Lumo has parsed
it, and any report that fails to parse is deleted 24h later; a report whose
ingest never even started is swept after 48h. GitHub only issues the OIDC
token on the `pull_request` event, and does not issue it to a fork's PR
workflow run, so nothing is reported for fork PRs from this path.

**What the OIDC token proves — and what it doesn't.** The token identifies the
repository, not a person, so anyone who can push a branch to the repository can
have a workflow run push security reports for that repository's pull requests —
exactly the trust the repository already places in its own CI. Pull requests
opened from forks receive no OIDC token at all and are therefore never reported
on. Reports are attributed to the workspace that owns the `PullRequest` row
they land on, so re-linking a repository to another workspace leaves the old
workspace's existing PR rows (and their findings) where they are.

**Unknown-vulnerability hunt (L3).** When a pull request touches an API
route or server action, a dangerous call (raw SQL, child processes, `fetch`,
`eval`, file writes, LLM calls) or an authentication / validation check, Lumo
builds an in-memory call subgraph of the touched TypeScript files plus their
direct imports, sends that map — and, on demand, the touched files — to the
model gateway for a bounded hunt across six checklists (IDOR, injection,
SSRF, prompt injection, races, business logic), mechanically checks every
candidate against the subgraph (symbols, line numbers and the full call
chain must exist), and lets a second model try to refute what survives.
Only unrefuted candidates become findings, always advisory: they never block
Done. Budget ≤ 150k tokens / 200 s per scan; nothing from the repository is
stored beyond the finding's symbols, line numbers and redacted text. Set
`LUMO_SECURITY_HUNT=off` to disable the hunt for a deployment.

**Policy, suggestions and what reaches the PR (LUM-740).** Which findings
block a task from reaching Done is a per-workspace policy
(`Workspace.securityPolicy`, `{ "block": [{ "provenance", "severity" }] }`,
set through `PATCH /api/workspaces/me`); unset, only an undispositioned
pattern-matched (deterministic) HIGH finding blocks, exactly as before. LLM
findings — the hunt above and the LLM review — can never be configured to
block: the API refuses the value and the reader ignores it. Every
external-tool finding also goes through a falsifier once (a second model
that may only refute, never confirm — `LUMO_SECURITY_SUGGEST=off` disables
it); a refutation becomes a _suggested_ false positive with the model's
reasoning, shown in the panel with a one-click "confirm all" for humans, and
each confirm or overrule is recorded so the suggestion's precision can be
measured (LUM-740). To keep the pull
request readable, LOW-severity findings (test and fixture paths, placeholder
values) and suggested false positives get no inline comment — the summary
comment carries one line for each group and links to Lumo — and the summary
itself is updated in place by the comment id stored on the scan, so
concurrent scan layers never post a second one. A GitHub check-run
(`lumo/security`) is deliberately not posted: it would need the App's
`Checks: write` permission, which every installation would have to
re-accept, and the summary comment already carries the same verdict; it will
be added when a team asks for it as a required status in branch protection.

**Trust boundary.** The managed scan uses the App's existing `Contents: read`
permission — no new GitHub permission is requested — and the clone lives only
inside the one-shot Vercel Sandbox VM for the duration of the scan before the
VM is destroyed. Set `LUMO_MANAGED_SCAN=off` to disable the managed scan for a
deployment; the BYO path above still works when it is off.

**Cost controls.** Every managed scan is a 2 vCPU Vercel Sandbox capped at
12 minutes. Three guards keep a webhook storm from turning into a bill: when
a pull request gets a newer commit, the still-pending scan of the older commit
is marked _superseded_, its workflow run is cancelled and its sandbox stopped;
a scan whose scanner has not reported within 45 minutes is marked failed by a
sweep that runs every 15 minutes, so nothing reads "scanning" forever; and
each workspace may start at most `LUMO_MANAGED_SCAN_HOURLY_CAP` managed scans
per rolling hour (default 20) — beyond that the scan is recorded as failed
with a `rate-limited` reason and no sandbox starts. The hard ceiling is
Vercel's own Spend Management (project → Settings → Billing → Spend
Management): set an amount, a notification email, and enable pausing so a
runaway never outlives the budget. That setting is made once in the
dashboard, not in code.

**Tests and builds come from your own CI.** Lumo runs static analysis only
(the scan above) and never executes a repository's tests or build. The
typecheck / test / build verdicts on a task's delivery gates are read back from
the checks your CI reports on the pull request (GitHub check runs and commit
statuses); a check is recognised by its name (`typecheck` / `tsc`, `test` /
`jest` / `vitest`, `build` / `deploy`, …).
