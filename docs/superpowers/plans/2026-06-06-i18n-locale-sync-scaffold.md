# i18n locale-sync scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `tsx` codegen script that back-fills every key missing from the non-`en` locale files in `lib/i18n/` with a grep-able `[TODO:<locale>] <en value>` placeholder, so the strict 16-locale parity test passes after a developer edits only `en.json`.

**Architecture:** Pure functions (`diffKeys`, `placeholder`, `syncLocale`, `serialize`, `discoverLocaleFiles`) carry the logic and are unit-tested in isolation; a thin `main()` CLI runner does the filesystem I/O and dispatches `--check` (dry-run, exits 1 on drift) vs default (write). The runner is import-guarded so tests can import the module without side effects. This mirrors the existing `scripts/lint-tokens.ts` pattern.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess` on), `tsx`, Jest, `node:fs` / `node:path`.

---

## Spec

See `docs/superpowers/specs/2026-06-06-i18n-locale-sync-scaffold-design.md`.

## File Structure

- Create: `scripts/i18n-sync-locales.ts` — pure functions + `main()` CLI runner.
- Create: `__tests__/i18n-sync-locales.test.ts` — unit tests over the pure functions.
- Modify: `package.json` — add `i18n:sync` and `i18n:check` npm scripts.
- Modify: `CLAUDE.md` — i18n section gains a pointer to `npm run i18n:sync`.

## Conventions to follow (from the existing codebase)

- `scripts/lint-tokens.ts` is the template: `import { ... } from 'node:fs'`, exported
  pure functions/types, `process.stderr.write` + `process.exit(1)` for failures, and a
  runner guard `if (process.argv[1] && process.argv[1].endsWith('<file>.ts')) { main() }`.
- `noUncheckedIndexedAccess` is **on**: never index with `obj[key]` where `key` came from
  `Object.keys(...)` and feed the result somewhere typed `string` — TS makes it
  `string | undefined`. Iterate with `Object.entries(...)` so the value is typed `string`.
- Locale JSON files are flat `Record<string, string>`, 2-space indent, trailing newline.

---

### Task 1: Pure functions + unit tests

**Files:**

- Create: `scripts/i18n-sync-locales.ts`
- Test: `__tests__/i18n-sync-locales.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/i18n-sync-locales.test.ts`:

```ts
import {
  diffKeys,
  placeholder,
  syncLocale,
  serialize,
  discoverLocaleFiles,
} from '../scripts/i18n-sync-locales'

describe('diffKeys', () => {
  it('reports missing keys in en order and extra keys', () => {
    const en = { a: '1', b: '2', c: '3' }
    const locale = { a: 'x', c: 'y', z: 'old' }
    expect(diffKeys(en, locale)).toEqual({ missing: ['b'], extra: ['z'] })
  })

  it('returns empty arrays when in parity', () => {
    const en = { a: '1' }
    expect(diffKeys(en, { a: 'x' })).toEqual({ missing: [], extra: [] })
  })
})

describe('placeholder', () => {
  it('produces a grep-able [TODO:<locale>] marker with the en value', () => {
    expect(placeholder('fr', 'Cancel')).toBe('[TODO:fr] Cancel')
  })
})

describe('syncLocale', () => {
  it('appends missing keys as placeholders and preserves existing translations', () => {
    const en = { a: 'A', b: 'B', c: 'C' }
    const locale = { a: 'Annuler' }
    expect(syncLocale(en, locale, 'fr')).toEqual({
      a: 'Annuler',
      b: '[TODO:fr] B',
      c: '[TODO:fr] C',
    })
  })

  it('leaves extra keys intact', () => {
    const en = { a: 'A' }
    const locale = { a: 'Annuler', z: 'orphan' }
    expect(syncLocale(en, locale, 'fr')).toEqual({ a: 'Annuler', z: 'orphan' })
  })

  it('is idempotent', () => {
    const en = { a: 'A', b: 'B' }
    const once = syncLocale(en, { a: 'Annuler' }, 'fr')
    const twice = syncLocale(en, once, 'fr')
    expect(twice).toEqual(once)
  })

  it('does not mutate the input locale object', () => {
    const en = { a: 'A', b: 'B' }
    const locale = { a: 'Annuler' }
    syncLocale(en, locale, 'fr')
    expect(locale).toEqual({ a: 'Annuler' })
  })
})

describe('serialize', () => {
  it('emits 2-space JSON with a trailing newline', () => {
    expect(serialize({ a: '1' })).toBe('{\n  "a": "1"\n}\n')
  })
})

describe('discoverLocaleFiles', () => {
  it('lists locale json files excluding en.json', () => {
    const files = discoverLocaleFiles()
    expect(files).not.toContain('en.json')
    expect(files).toContain('fr.json')
    expect(files.every(f => f.endsWith('.json'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- i18n-sync-locales`
Expected: FAIL — `Cannot find module '../scripts/i18n-sync-locales'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/i18n-sync-locales.ts`:

```ts
/**
 * i18n locale-sync scaffold.
 *
 * en.json is the source of truth for the key set. This script back-fills every
 * key that is missing from the other locale files with a non-empty, grep-able
 * placeholder: `[TODO:<locale>] <english value>`. The strict parity test
 * (__tests__/i18n-locale-parity.test.ts) goes GREEN; real translations replace
 * the [TODO:...] markers later.
 *
 * Usage:
 *   tsx scripts/i18n-sync-locales.ts          # write missing placeholders
 *   tsx scripts/i18n-sync-locales.ts --check  # dry-run; exit 1 if any drift
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Messages = Record<string, string>

const I18N_DIR = join(__dirname, '..', 'lib', 'i18n')
const SOURCE = 'en.json'

/** Keys present in en but not locale (en order), and keys in locale but not en. */
export function diffKeys(
  en: Messages,
  locale: Messages
): { missing: string[]; extra: string[] } {
  const missing = Object.keys(en).filter(k => !(k in locale))
  const extra = Object.keys(locale).filter(k => !(k in en))
  return { missing, extra }
}

/** Non-empty, grep-able placeholder for an untranslated value. */
export function placeholder(localeName: string, enValue: string): string {
  return `[TODO:${localeName}] ${enValue}`
}

/**
 * Return localeObj with missing keys appended (en order) as placeholders.
 * Existing values are never overwritten; extra keys are left untouched.
 */
export function syncLocale(
  en: Messages,
  localeObj: Messages,
  localeName: string
): Messages {
  const result: Messages = { ...localeObj }
  for (const [key, value] of Object.entries(en)) {
    if (!(key in result)) {
      result[key] = placeholder(localeName, value)
    }
  }
  return result
}

/** 2-space JSON with a trailing newline, matching the existing files. */
export function serialize(obj: Messages): string {
  return JSON.stringify(obj, null, 2) + '\n'
}

/** Locale file names in lib/i18n (e.g. "fr.json"), excluding en.json, sorted. */
export function discoverLocaleFiles(dir: string = I18N_DIR): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith('.json') && f !== SOURCE)
    .sort()
}

function loadJson(path: string): Messages {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Messages
  } catch (err) {
    process.stderr.write(
      `✗ failed to read/parse ${path}: ${(err as Error).message}\n`
    )
    process.exit(1)
  }
}

function localeName(file: string): string {
  return file.replace(/\.json$/, '')
}

function main(): void {
  const check = process.argv.includes('--check')
  const en = loadJson(join(I18N_DIR, SOURCE))
  const files = discoverLocaleFiles()

  let drift = false
  for (const file of files) {
    const name = localeName(file)
    const path = join(I18N_DIR, file)
    const locale = loadJson(path)
    const { missing, extra } = diffKeys(en, locale)

    if (extra.length > 0) {
      drift = true
      process.stderr.write(
        `⚠ ${name} has ${extra.length} key(s) not in en (left untouched): ${extra.join(', ')}\n`
      )
    }
    if (missing.length === 0) continue

    drift = true
    if (check) {
      process.stdout.write(`${name}: ${missing.length} missing\n`)
    } else {
      writeFileSync(path, serialize(syncLocale(en, locale, name)), 'utf8')
      process.stdout.write(`${name}: +${missing.length} keys\n`)
    }
  }

  if (check && drift) {
    process.stderr.write(
      '\n✗ i18n:check — locales are out of parity. Run `npm run i18n:sync`.\n'
    )
    process.exit(1)
  }
  if (!drift) {
    process.stdout.write('✓ all locales in parity with en.json\n')
  }
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('i18n-sync-locales.ts')) {
  main()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- i18n-sync-locales`
Expected: PASS — all describe blocks green (diffKeys, placeholder, syncLocale, serialize, discoverLocaleFiles).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `en[key]` style indexing slipped in, `noUncheckedIndexedAccess` would flag it here — the implementation uses `Object.entries` to avoid that.)

- [ ] **Step 6: Commit**

```bash
git add scripts/i18n-sync-locales.ts __tests__/i18n-sync-locales.test.ts
git commit -m "feat: i18n locale-sync scaffold script + tests [LUM-268]"
```

---

### Task 2: npm scripts

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Add the two scripts**

In `package.json`, in the `"scripts"` block, immediately after the `"lint:tokens:update"` line, add:

```json
    "i18n:sync": "tsx scripts/i18n-sync-locales.ts",
    "i18n:check": "tsx scripts/i18n-sync-locales.ts --check",
```

(Ensure the preceding line ends with a comma and JSON stays valid.)

- [ ] **Step 2: Verify the script runs end-to-end against the real repo (dry-run)**

Run: `npm run i18n:check`
Expected: exit code 0 and `✓ all locales in parity with en.json` — the current `main`
branch is already in parity, so this proves the runner wires up correctly with zero drift.
(Confirm exit code: `npm run i18n:check; echo "exit=$?"` → `exit=0`.)

- [ ] **Step 3: Verify write mode is a no-op when already in parity**

Run: `npm run i18n:sync && git status --short`
Expected: prints `✓ all locales in parity with en.json` and `git status --short` shows
**no** modified locale files (idempotent — nothing to back-fill).

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add i18n:sync / i18n:check npm scripts [LUM-268]"
```

---

### Task 3: Document in CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` (the `## i18n` section)

- [ ] **Step 1: Add the pointer bullet**

In `CLAUDE.md`, the `## i18n` section currently reads:

```md
## i18n

- All user-facing strings use react-intl (`intl.formatMessage`)
- Locale files live in `lib/i18n/` — when adding or updating a key, update **every** locale file, not just en.json and zh-CN.json
- Never use English as a fallback for non-English locales — provide a proper translation for each language
```

Append one bullet at the end of that list:

```md
- To scaffold the other locales after editing `en.json`, run `npm run i18n:sync` — it back-fills missing keys with `[TODO:<locale>] …` placeholders so the parity test passes; replace the `[TODO:…]` markers with real translations before shipping (never leave the English placeholder). Use `npm run i18n:check` to detect drift without writing.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: point i18n workflow at npm run i18n:sync [LUM-268]"
```

---

### Task 4: Final verification

- [ ] **Step 1: Full test suite**

Run: `npm test -- i18n`
Expected: PASS — both `i18n-sync-locales` and the existing `i18n-locale-parity` suites green.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors (no raw hex / palette classes introduced; this script touches no styles).

- [ ] **Step 4: Confirm no stray changes / no console.log**

Run: `git status` and review `git diff origin/main --stat`
Expected: only `scripts/i18n-sync-locales.ts`, `__tests__/i18n-sync-locales.test.ts`,
`package.json`, `CLAUDE.md`, and the two `docs/superpowers/` files. No `console.log` in the
script (uses `process.stdout`/`process.stderr`).

---

## Self-Review

- **Spec coverage:**
  - Sync mode / en.json source of truth → Task 1 (`diffKeys`, `syncLocale`, `main`).
  - Directory-derived target locales → `discoverLocaleFiles` (Task 1).
  - `[TODO:<locale>] <en value>` placeholder → `placeholder` (Task 1).
  - Append-not-reorder, never overwrite, extra keys untouched → `syncLocale` (Task 1) + tests.
  - Default-write vs `--check` exit-1-on-drift (missing OR extra) → `main` (Task 1), verified Task 2.
  - Error handling (unparseable JSON → exit 1 with filename) → `loadJson` (Task 1).
  - Idempotency → `syncLocale` idempotency test (Task 1) + Task 2 Step 3.
  - npm scripts → Task 2.
  - CLAUDE.md doc update → Task 3.
- **Placeholder scan:** No "TBD/TODO/implement later" plan-gaps. (The literal `[TODO:...]`
  strings are intentional product output, not plan placeholders.) All code shown in full.
- **Type consistency:** `Messages` type, function names (`diffKeys`, `placeholder`,
  `syncLocale`, `serialize`, `discoverLocaleFiles`) and signatures are identical between the
  test imports (Task 1 Step 1) and the implementation (Task 1 Step 3).
