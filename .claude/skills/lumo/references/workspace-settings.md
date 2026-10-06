# Workspace settings

### `lumo workspace security-scan` — PR security-scan switches (LUM-1002)

Shows or changes the workspace's PR security-scan switches — the same three as Settings → Workspace → **PR security scanning** in the web app:

- **Security scan** (master) — off = no layer runs on new pushes and no scan comment is posted.
- **AI review** — LLM security review, change summary, false-positive suggestions, semantic rules, claim checks and AI triage of boundary crossings.
- **Exploit-path hunt** — sandboxed AI agent confirming exploitability.

The platform env is the ceiling: a workspace can only turn a layer off, never on past it (the `Platform` column; `-` = no platform switch). `Runs` is what actually runs. Any member may read; changing is **OWNER only** — anyone else gets `Error: only workspace owners can change security-scan settings` (exit 1) before any confirmation envelope. Changes from either surface write the same `workspace.security_settings_updated` audit event: source `CLI` for this command (any API-key request), `WEB` for the settings card.

```bash
lumo workspace security-scan
lumo workspace security-scan --disable-all
lumo workspace security-scan --enable-all
lumo workspace security-scan --hunt off --ai-review on
lumo workspace security-scan --json
```

```
Layer                     Setting  Platform  Runs
Security scan (master)    on       -         yes
Managed scanners (L1/L2)  on       on        yes
AI review                 on       -         yes
Exploit-path hunt         on       off       no
```

Flags:

- `--scan <on|off>`, `--ai-review <on|off>`, `--hunt <on|off>` — set single switches (`true`/`false` also accepted).
- `--disable-all` / `--enable-all` — every switch at once; cannot be combined with each other or with the single-switch flags.
- **Turning anything off is gated** by the confirmation protocol ([confirmation.md](confirmation.md)): without `--confirm` it exits 4 with an envelope listing each switch it would turn off and sends nothing. Turning switches on needs no confirmation.
- `--json` prints `{ switches: { securityScanEnabled, securityAiReviewEnabled, securityHuntEnabled }, platform: { managedScan, hunt }, effective: { scan, managedScan, aiReview, hunt, aiReviewTurnedOff, huntTurnedOff }, canEdit }` (`canEdit` = the caller is an OWNER).

### When to suggest `workspace security-scan`

- "Turn off / pause code scanning", "stop the AI review on our PRs", "why didn't the hunt run" — and the user is a workspace owner (reading is open to anyone).
- **Never** turn a switch off on your own initiative (e.g. to make findings go away): relay the exit-4 envelope and let the user decide. Earlier blocking findings still block Done either way.
