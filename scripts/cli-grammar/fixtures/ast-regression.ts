/**
 * LUM-413: AST-validator regression set, fixture-encoded from real prod
 * HookEvent history (LUM-392 extraction, 2026-05-16 → 2026-06-10).
 *
 * HALLUCINATION_CASES are the historical flag-hallucination / unknown-command
 * invocations agents actually issued; `expect` is the verdict against the
 * CURRENT grammar snapshot. Cases can deliberately differ from what commander
 * said at the time:
 *   - sibling invocations in the same Bash call used to inherit each other's
 *     error evidence (output is shared); the AST verdict is per-segment, so
 *     `lumo session --help` (which co-ran with a --verbose hallucination) is
 *     correctly valid here.
 *   - LUM-420 re-adjudicated two former illegal-enum classes as valid (now in
 *     VALID_CASES): `--source Superpowers` (--source is an open `e.g.` example
 *     list, not a closed enum) and uppercase enum values like `--category
 *     DECISION` (the CLI runtime normalizes case before validating).
 *
 * VALID_CASES guard against false positives: real successful invocation
 * shapes (short flags, =values, redirections, $VAR values, repeatable flags).
 *
 * Kept outside __tests__/ — jest's testMatch treats every file in there as a
 * suite.
 */
import type { AstVerdictKind } from '../validate'

export interface AstCase {
  raw: string
  expect: AstVerdictKind
  offending?: string
  note?: string
}

export const HALLUCINATION_CASES: AstCase[] = [
  {
    raw: 'lumo session attach LUM-43 --verbose 2>&1',
    expect: 'unknown-flag',
    offending: '--verbose',
    note: 'no global --verbose exists (documented in skill "does NOT exist" list)',
  },
  {
    raw: 'lumo project memory list --project lumo 2>&1',
    expect: 'unknown-command',
    offending: 'memory',
    note: 'LUM-1233 3b: `project memory` was removed — it is `memory list --scope project`',
  },
  {
    raw: 'lumo memory add --scope project --category procedural --content $BODY 2>&1',
    expect: 'unknown-flag',
    offending: '--content',
    note: 'memory is structured fields; --content never existed',
  },
  {
    raw: 'lumo task comment add --task LUM-345 --body Follow-up PR: https://github.com/Lumo-Workspace/lumo/pull/451 2>&1',
    expect: 'unknown-flag',
    offending: '--body',
    note: 'body is positional on task comment add (LUM-1233 3j: was task comment <task> <body>)',
  },
  {
    raw: 'lumo auth status 2>&1',
    expect: 'unknown-command',
    offending: 'status',
    note: 'identity check is `lumo whoami`',
  },
  {
    raw: 'lumo task delete LUM-178 --yes 2>&1',
    // Re-adjudicated in LUM-821: `task delete` exists now, but it takes only
    // `--confirm` (the user-approval flag) — no legacy `--yes` alias.
    expect: 'unknown-flag',
    offending: '--yes',
    note: 'task delete approves with --confirm only (LUM-821); --yes is not an alias',
  },
  {
    raw: 'lumo task list --status invalid 2>&1',
    expect: 'illegal-enum',
    offending: 'invalid',
  },
]

export const VALID_CASES: AstCase[] = [
  {
    raw: 'lumo sprint list --project lumo 2>&1',
    expect: 'valid',
    note: 'LUM-1233 3g: --project is global — every command accepts it (sprint list ignores it)',
  },
  { raw: 'lumo task update LUM-100 --status in_progress', expect: 'valid' },
  {
    raw: 'lumo task artifact add LUM-122 --kind spec --title Context-injection tiering spec --file docs/specs/design.md --source Superpowers --agent claude-code 2>&1',
    expect: 'valid',
    note: 'LUM-420: --source is an open e.g. example list (opaque free text), not a closed enum — 135 real Superpowers calls were misflagged before',
  },
  {
    raw: 'lumo memory add --task LUM-352 --category DECISION --what "Chose option B over option A" 2>&1',
    expect: 'valid',
    note: 'LUM-420: runtime lowercases --category before validating; uppercase variants are legal constructions',
  },
  {
    raw: 'lumo task update LUM-200 --status DONE 2>&1',
    expect: 'valid',
    note: 'LUM-420: normalizeStatus uppercases before validating — 18 historical uppercase calls were misflagged',
  },
  {
    raw: 'lumo task update LUM-1 -s done -p high',
    expect: 'valid',
    note: 'short aliases resolve to long flags incl. enum check',
  },
  { raw: 'lumo task status LUM-343 --full', expect: 'valid' },
  { raw: 'lumo task show LUM-343 --full --comments', expect: 'valid' },
  {
    raw: 'lumo crossing explain cr-abc123 --note "false positive"',
    expect: 'valid',
  },
  {
    raw: 'lumo task comment add "multi word body here" --task LUM-345',
    expect: 'valid',
  },
  {
    raw: 'lumo task list --status done > /tmp/tasks.txt',
    expect: 'valid',
    note: 'redirection target must not be read as a positional/flag',
  },
  { raw: 'lumo whoami 2>&1', expect: 'valid' },
  {
    raw: 'lumo task update LUM-5 --status $NEW_STATUS',
    expect: 'valid',
    note: 'shell-dynamic values are statically unjudgeable — never flagged',
  },
  {
    raw: 'lumo session --help',
    expect: 'valid',
    note: 'group + --help is a legitimate help invocation',
  },
  { raw: 'lumo --version', expect: 'valid' },
  { raw: 'lumo', expect: 'valid', note: 'bare lumo prints help' },
  {
    raw: 'lumo task create "New task title" --priority high --tag a --tag b',
    expect: 'valid',
    note: 'repeatable flags',
  },
  { raw: 'lumo task update LUM-9 --status=done', expect: 'valid' },
  {
    raw: 'lumo memory delete cmq7pwqod000p04lgv0crvqox --confirm',
    expect: 'valid',
  },
  {
    raw: 'lumo help task',
    expect: 'valid',
    note: "commander's built-in help subcommand",
  },
  {
    raw: 'lumo $CMD LUM-1',
    expect: 'valid',
    note: 'dynamic command token — statically unjudgeable, never flagged',
  },
  {
    raw: 'lumo task comment add "body mentioning --verbose and --status DONE" --task LUM-345',
    expect: 'valid',
    note: 'quoted free text must not leak fake flags/enums (quoting preserved since LUM-413)',
  },
  {
    raw: 'lumo task comment add unquoted body --chart-* (prose debris)',
    expect: 'valid',
    note: 'dirty flag-shaped tokens are extraction noise, skipped not judged',
  },
  {
    raw: 'lumo task context" echo',
    expect: 'valid',
    note: 'quote debris in command position — unjudgeable noise',
  },
  {
    raw: 'lumo task create "T" --description "$(cat <<EOF\nbody with "quotes" and --noEmit\nEOF\n)"',
    expect: 'valid',
    note: 'heredoc bodies desync quote tracking — declined, never judged',
  },
]

export const CONSTRUCTION_EDGE_CASES: AstCase[] = [
  {
    raw: 'lumo task',
    expect: 'unknown-command',
    note: 'bare group: right tool family, incomplete construction (no offending token)',
  },
  {
    raw: 'lumo task foo LUM-1',
    expect: 'unknown-command',
    offending: 'foo',
  },
  {
    raw: 'lumo task update LUM-9 --status=bogus',
    expect: 'illegal-enum',
    offending: 'bogus',
  },
]
