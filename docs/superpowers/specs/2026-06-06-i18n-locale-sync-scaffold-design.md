# i18n locale-sync scaffold — design [LUM-268]

## Problem

The strict 16-locale parity test (`__tests__/i18n-locale-parity.test.ts`) asserts that
every non-`en` locale file in `lib/i18n/` has **exactly** the same key set as `en.json`
and that **every value is non-empty**. Adding a user-facing key to only `en.json` (+
`zh-CN`) turns the test RED for the other 14 locales until each is hand-edited.

Source memory: `i18n_strict_locale_parity_test` — "adding a user-facing key to only
en/zh-CN turns it RED for the other 14 locales".

## Goal

A codegen script that scans `en.json` and back-fills every missing key into all other
locale files with a clearly-marked, non-empty placeholder — so a developer edits
`en.json` (and optionally `zh-CN`), runs one command, and the parity test goes GREEN.
The placeholders are grep-able so real translations can be back-filled later.

## Non-goals

- Machine translation of placeholders (a separate concern; existing
  `scripts/translate-i18n-*.ts` cover that pattern).
- Auto-pruning extra keys (reported, not deleted — see Edge cases).
- Wiring into husky/CI (the existing parity test already gates jest; `--check` is
  available if we later want a dedicated CI step).

## Approach

A standalone `tsx` script (`scripts/i18n-sync-locales.ts`), matching the existing
`scripts/translate-i18n-*.ts` / `scripts/lint-tokens.ts` convention. Core logic lives in
exported pure functions; the CLI runner is guarded so the module can be imported by tests
without side effects.

## Interface

- Script: `scripts/i18n-sync-locales.ts`
- npm scripts:
  - `i18n:sync` → `tsx scripts/i18n-sync-locales.ts` (writes)
  - `i18n:check` → `tsx scripts/i18n-sync-locales.ts --check` (dry-run, CI-friendly)
- **Source of truth**: the key set of `lib/i18n/en.json`.
- **Target locales**: every `*.json` in `lib/i18n/` except `en.json`, derived from the
  directory listing so a future 17th locale is picked up automatically without editing
  the script. (`IntlProviderWrapper.tsx` and other non-`.json` files are ignored.)

## Core logic (pure functions)

```
diffKeys(en: Record<string,string>, locale: Record<string,string>)
  → { missing: string[], extra: string[] }
    // missing = keys in en not in locale, IN en's order
    // extra   = keys in locale not in en

placeholder(localeName: string, enValue: string): string
  → `[TODO:${localeName}] ${enValue}`

syncLocale(en, localeObj, localeName)
  → Record<string,string>
    // returns existing localeObj with missing keys APPENDED (en order),
    // each value = placeholder(localeName, en[key]).
    // Existing values are never overwritten. Extra keys are left untouched.

serialize(obj: Record<string,string>): string
  → JSON.stringify(obj, null, 2) + '\n'   // matches existing file format
```

## Modes

- **Default (write)**: for each target locale, compute `diffKeys`, append placeholders
  for `missing`, write the file via `serialize`. Print a per-locale summary
  (`fr: +12 keys`). For any `extra` keys, print a warning but do not delete:
  `⚠ fr has 2 keys not in en: [...]`.
- **`--check` (dry-run)**: compute the same diff, print the report, write nothing. Exit
  code **1** if any locale has `missing` **or** `extra` keys; exit **0** if all locales
  are in parity.

## Edge cases & error handling

- `en.json` missing or unparseable → throw with a clear message, exit 1.
- A locale file unparseable → report the offending filename, exit 1.
- **Append, don't reorder**: each file keeps its existing key order; only new keys are
  appended at the end → minimal additive diff (per the `i18n_strict_locale_parity_test`
  convention: "flat dotted keys, JSON.stringify 2-space round-trips stable for a minimal
  additive diff").
- **Extra keys** (in a locale but not `en`, e.g. a key removed from `en`) are reported,
  never auto-removed, to avoid accidental data loss. A future `--prune` flag could handle
  this; out of scope now (YAGNI).
- **Idempotency**: running the script twice in a row produces no changes — guaranteed by
  only ever appending `missing` keys and never overwriting.

## Testing

`__tests__/i18n-sync-locales.test.ts` — unit tests over the pure functions with in-memory
objects (no filesystem):

- `diffKeys` reports correct `missing` (en order) and `extra`.
- `placeholder` produces the `[TODO:<locale>] <en value>` shape.
- `syncLocale` appends missing keys with placeholders, preserves existing translations,
  leaves extra keys intact.
- Idempotency: `syncLocale` over an already-synced object returns an equal object.
- `serialize` emits 2-space JSON with a trailing newline.

## Docs

Update the **i18n** section of `CLAUDE.md`: keep the "update every locale file" rule but
add a line noting that `npm run i18n:sync` scaffolds the missing locales with `[TODO:...]`
placeholders (which still need real translations before shipping). This serves the task's
DevEx-friction goal.
