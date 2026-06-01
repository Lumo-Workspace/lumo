# LUM-139 — CLI: strip control characters before printing server-side fields

**Task:** LUM-139 · CLI: 打印服务端字段前过滤控制字符，防止终端转义序列注入
**Milestone:** CLI Security Hardening
**Severity:** Medium (ANSI escape-sequence injection)
**Date:** 2026-06-01

## Problem

Many CLI commands print server-returned fields — values that other workspace
members can control (task titles, comments, doc titles, member display names,
Figma frame names, etc.) — verbatim to the terminal via `process.stdout.write`
/ `console.log`. A malicious member can embed ANSI escape sequences (notably
`\x1b` / ESC) in such a field to rewrite terminal display, forge CLI output, or
trigger dangerous control sequences in some terminals.

Example: `task-artifact-add.ts:140` writes `artifact.title` directly.

## Goal

Strip terminal control characters from **untrusted, server-returned** fields
before printing. Centralize the logic in one reusable function applied at the
format layer / print sites.

## Design

### 1. New module: `cli/src/lib/sanitize.ts`

```ts
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/**
 * Strip terminal control characters (including ESC, \x1b, and the 8-bit CSI
 * introducer \x9b) from untrusted server-returned fields before printing them
 * to the terminal. Prevents ANSI escape-sequence injection. Keeps tab (\x09)
 * and newline (\x0a) so multi-line bodies and tabular output are not flattened.
 */
export function sanitizeField(value: string): string {
  return value.replace(CONTROL_CHARS, '')
}
```

Single responsibility, independently testable. Every other module imports just
this one function. Callers handle optional/undefined values themselves (e.g.
`sanitizeField(name ?? '')`).

### 2. Character set

Based on the regex recommended in the task, extended to also cover the C1
range: `/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g`.
- Strips ESC (`\x1b`), NUL, DEL, other C0 control chars, and the C1 control
  range (`\x80`–`\x9f`, notably the 8-bit CSI introducer `\x9b`). U+0080–U+009F
  are never legitimate visible text, so stripping them is safe and closes an
  8-bit injection vector.
- **Keeps** tab (`\x09`) and newline (`\x0a`) so multi-line bodies and
  fixed-width tables render correctly.

### 3. Application points (untrusted, server-controlled fields only)

> **Scope note (added during implementation).** The enumeration below was the
> initial pass. Adversarial completeness sweeps during implementation found the
> list was incomplete relative to the security goal ("strip control chars from
> **all** untrusted server fields, stdout **and** stderr"). The final
> implementation therefore covers, in addition to the list below:
> - **All `show` / `list` / `context` formatters:** `task show`, `task context`
>   (incl. the server **memory section** + every context section blob),
>   `sprint show/list`, `milestone show/list`, `doc show`, `project list`,
>   `task artifact list`, `task figma list`, `doc share-list`, `session
>   status/detach` task titles, `whoami` workspace/key names + email,
>   `auth-login`/`auth-logout` email.
> - **Memory free-text** via `memory-content.ts` `headline()` (drives
>   `memory task/project memory list`): trigger/what/rule/workflow/etc.
> - **Tag names** in the `Tags:` line of every create/update formatter (task + doc).
> - **All server error-body strings** (`res.json().error` / `res.text()`),
>   wrapped at each `console.error(\`Error: ${serverMsg}\`)` site, at the central
>   `index.ts` catch (covers all throw-based paths), and at the single point in
>   helper-thrown messages that embed the server body (`tag-resolver.ts`,
>   `resolve-member.ts`).
> - **stderr** refusal / ambiguous-candidate / sync-error messages
>   (`sprint-close`/`sprint-delete`/`milestone-delete` refusals, `doc-move` /
>   `resolve-doc-id` candidate lists, figma `syncError` / refresh `r.error`),
>   plus the hook session-start `taskTitle`.
>
> A final static trace triaged **259** interpolating output sites; **64** carry
> untrusted free-text and are all wrapped (≈230 `sanitizeField` call-sites
> total). The categories below remain the canonical "definitely sanitize" core.

Apply `sanitizeField()` immediately before the value is emitted.

**In format-layer helpers (sanitize inside the helper; callers unchanged):**
- `formatTaskListTable` — `title`, `project.name`
- `formatSprintUpdateSummary` / sprint-update output — sprint `name`
- `formatMilestoneUpdateSummary` — milestone `name`
- sprint summary formatter (`sprint-summary.ts`)
- doc tree rendering (`doc-tree.ts`) — doc titles

**At inline print sites:**
- `task-artifact-add.ts` — `artifact.title`
- `task-artifact-show.ts` — `artifact.title`, `artifact.content`
- `task-comment-list.ts` — comment `author`, body lines
- `task-slack-show.ts` — `userName`, `text`
- `task-figma-add.ts` / `task-figma-rm.ts` / `task-figma-refresh.ts` — `label`
- `task-figma-context.ts` — `fileName`, `frameName`
- `doc-share.ts` / `doc-unshare.ts` — `member.displayName`
- `sprint-start.ts` / `sprint-close.ts` / `sprint-delete.ts` / `task-create.ts` — sprint `name`
- `milestone-delete.ts` — milestone `name`
- `doc-create.ts` / `doc-update.ts` / `doc-sync.ts` / `doc-delete.ts` / `doc-import-gdoc.ts` / `doc-move.ts` — doc `title` (compose with the existing `\"`-escape; sanitize the raw title first, then quote-escape)
- `task-create.ts` / `task-update.ts` — task `title` (same compose-with-quote-escape)
- `task-pr-show.ts` — `authorLogin`
- `task-web-show.ts` — fetched `body`
- `auth-login.ts` — `workspace.name`, `apiKey.name`

### 4. Explicitly NOT sanitized

IDs / cuids, URLs, identifiers (`LUM-N`), status enums, priority enums, numbers,
and CLI-authored constant strings. These are not attacker-controlled, and
stripping could break clickable URLs.

### 5. Testing (TDD)

- `__tests__/cli/sanitize.test.ts` (CLI tests live under the root repo's
  `__tests__/cli/` and run via the root `jest`): strips ESC/NUL/DEL, keeps tab +
  newline, keeps ordinary text, empty string, clean string returned unchanged.
- In each affected format-helper test, add one assertion: a field containing ESC
  produces sanitized output (regression guard).

### 6. Out of scope

- No global wrapper around `process.stdout.write` / `console.log` — it cannot
  distinguish trusted from untrusted output and would corrupt URLs / formatting.
- No `SKILL.md` update — command invocation, flags, and output structure are
  unchanged; only invisible control chars are filtered out.

## Implementation notes

- Work in an isolated git worktree off the latest `origin/main` (the current
  checkout has unrelated unstaged LUM-137 work that must not be disturbed).
- Branch: `lumo/LUM-139-cli-sanitize-control-chars`.
