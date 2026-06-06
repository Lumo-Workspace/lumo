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
