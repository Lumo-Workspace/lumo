# Workspace settings

### `lumo workspace security-scan` — PR security-scan switches (LUM-1002)

Shows or changes the workspace's PR security-scan switches — the same three as Settings → Workspace → **PR security scanning** in the web app:

- **Security scan** (master) — off = no layer runs on new pushes and no scan comment is posted.
- **AI review** — LLM security review, change summary, false-positive suggestions, semantic rules, claim checks and AI triage of boundary crossings.
- **Exploit-path hunt** — sandboxed AI agent confirming exploitability.
- **Request-changes workflow** (LUM-1130, **off by default**, not a layer) — Lumo's PR review reads "Changes requested" while a Lumo thread or a finding that blocks Done is open, and Lumo approves once its complete review of the latest commit leaves nothing open (details: [pr-scan.md](pr-scan.md#request-changes-workflow-lum-1130)). `--disable-all` / `--enable-all` leave it unchanged.

The platform env is the ceiling: a workspace can only turn a layer off, never on past it (the `Platform` column; `-` = no platform switch). `Runs` is what actually runs. Any member may read; changing is **OWNER only** — anyone else gets `Error: only workspace owners can change security-scan settings` (exit 1) before any confirmation envelope. Changes from either surface write the same `workspace.security_settings_updated` audit event: source `CLI` for this command (any API-key request), `WEB` for the settings card.

```bash
lumo workspace security-scan
lumo workspace security-scan --disable-all
lumo workspace security-scan --enable-all
lumo workspace security-scan --hunt off --ai-review on
lumo workspace security-scan --request-changes on --confirm   # after the user approved the envelope
lumo workspace security-scan --json
```

```
Layer                     Setting  Platform  Runs
Security scan (master)    on       -         yes
Managed scanners (L1/L2)  on       on        yes
AI review                 on       -         yes
Exploit-path hunt         on       off       no

Request-changes workflow: off
```

Flags:

- `--scan <on|off>`, `--ai-review <on|off>`, `--hunt <on|off>`, `--request-changes <on|off>` — set single switches (`true`/`false` also accepted).
- `--disable-all` / `--enable-all` — every layer switch at once (not the request-changes workflow); cannot be combined with each other or with the single-switch flags.
- **Turning anything off — and turning the request-changes workflow on — is gated** by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` it exits 4 with an envelope listing each change and sends nothing. Turning layer switches on needs no confirmation.
- `--json` prints `{ switches: { securityScanEnabled, securityAiReviewEnabled, securityHuntEnabled, securityRequestChangesEnabled }, platform: { managedScan, hunt }, effective: { scan, managedScan, aiReview, hunt, aiReviewTurnedOff, huntTurnedOff }, canEdit }` (`canEdit` = the caller is an OWNER).
- On a server without the security plugin (e.g. a self-hosted open-source build) the command prints ``Error: `lumo workspace security-scan` is not available on this Lumo server — the security plugin is not installed there.`` and exits 1 (CLI ≥ 1.106.0); there are no switches to show or change.

### Per-repository automatic review — `--repos` / `--repo` (LUM-1133)

Lumo reviews every PR of each repository the workspace confirmed, including PRs **without a Lumo task**. Per repository (Settings → Workspace → **Automatic review by repository**): `Review` (default on) — whether task-less PRs are reviewed automatically; `Drafts` (default off) — whether drafts are reviewed before they are marked ready. Task-linked PRs are always scanned (Done checks their findings).

```bash
lumo workspace security-scan --repos                                  # list every connected repository
lumo workspace security-scan --repo acme/app                          # one repository
lumo workspace security-scan --repo acme/app --review off             # exit 4 envelope until --confirm
lumo workspace security-scan --repo acme/app --drafts on              # turning on needs no confirmation
lumo workspace security-scan --repos --json                           # { repositories: [{ repo, autoReview, reviewDrafts }], canEdit }
```

```
Repository  Review  Drafts
acme/app    on      off
acme/web    off     off
```

- `--review <on|off>` / `--drafts <on|off>` need `--repo`; neither combines with the switch flags (`--scan`, `--ai-review`, `--hunt`, `--request-changes`, `--disable-all`, `--enable-all`).
- A repository the workspace has not connected → `Error: repository … is not connected to this workspace` (exit 1).
- Turning `--review` or `--drafts` **off** is gated by the confirmation protocol (exit 4, nothing sent); OWNER only, refused before any envelope for anyone else. Each change writes a `repository.review_settings_updated` audit event (target `repository`, `{ repo, from, to }`).

### When to suggest `workspace security-scan`

- "Turn off / pause code scanning", "stop the AI review on our PRs", "why didn't the hunt run" — and the user is a workspace owner (reading is open to anyone).
- "Don't review PRs in repo X", "review drafts too", "why was my PR without a task (not) reviewed" → `--repos` / `--repo`.
- "Make Lumo request changes / approve PRs", "CodeRabbit-style request changes" → `--request-changes on` (exits 4 first; relay the envelope).
- **Never** turn a switch off on your own initiative (e.g. to make findings go away): relay the exit-4 envelope and let the user decide. Earlier blocking findings still block Done either way.
