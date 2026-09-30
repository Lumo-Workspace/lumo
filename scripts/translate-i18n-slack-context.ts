/**
 * One-shot script: read slackContext.* keys from en.json,
 * translate any keys missing in the other locales via the central
 * TRANSLATION_MODEL (deepseek fast tier), and write
 * back. Idempotent — keys that already exist are left as-is, even if
 * different from a fresh translation, so manual touch-ups stick.
 *
 * Run with:
 *   npx tsx scripts/translate-i18n-slack-context.ts
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { generateObject } from 'ai'
import { gateway } from '../lib/ai/gateway'
import { z } from 'zod'
import { TRANSLATION_MODEL } from '../lib/ai/models'

const I18N_DIR = path.resolve(__dirname, '../lib/i18n')
const SOURCE_LOCALE = 'en'
const MODEL_ID = TRANSLATION_MODEL

const LOCALES: Record<string, string> = {
  de: 'German',
  'en-AU': 'Australian English',
  'en-GB': 'British English',
  es: 'European Spanish (Spain)',
  'es-419': 'Latin American Spanish',
  fr: 'French',
  hi: 'Hindi',
  id: 'Indonesian',
  ja: 'Japanese',
  ko: 'Korean',
  ms: 'Malay',
  ru: 'Russian',
  vi: 'Vietnamese',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
}

const TARGET_KEY_PREFIXES = ['slackContext.']

function readJson(file: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeJson(file: string, data: Record<string, string>) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}

interface KeyValue {
  key: string
  source: string
}

async function translateBatch(
  pairs: KeyValue[],
  targetLanguage: string
): Promise<Record<string, string>> {
  const schema = z.object({
    translations: z.array(
      z.object({
        key: z.string(),
        value: z.string(),
      })
    ),
  })

  const system = `You are a UI string translator for a project-management product called Lumo.
Translate the given English UI strings into ${targetLanguage}. Rules:
- Preserve ICU message format placeholders verbatim — {n}, {n, plural, one {# event} other {# events}}, {value}, etc. Do not translate content inside braces.
- Keep brand-y or technical terms in English when natural for the target language: "Agent", "Turn", "Run", "Worktree", "Subagent", "session", "lumo task start".
- Match the casing/punctuation style of the source ("hide" → lowercase, "Agent finished" → sentence case).
- Output ONLY the translation for the value field. No surrounding quotes.
- Keep translations terse — these are UI labels, not prose.
Return one entry per input key, in the same order.`

  const user = `Translate the following English UI strings to ${targetLanguage}:

${pairs.map(p => `- key: ${p.key}\n  source: ${p.source}`).join('\n')}`

  const { object } = await generateObject({
    model: gateway(MODEL_ID),
    schema,
    system,
    prompt: user,
  })

  const out: Record<string, string> = {}
  for (const t of object.translations) out[t.key] = t.value
  return out
}

async function main() {
  const sourcePath = path.join(I18N_DIR, `${SOURCE_LOCALE}.json`)
  const sourceData = readJson(sourcePath)

  const targetKeys = Object.keys(sourceData).filter(k =>
    TARGET_KEY_PREFIXES.some(p => k.startsWith(p))
  )
  console.log(
    `[i18n] ${targetKeys.length} agentRun keys in source (${SOURCE_LOCALE})`
  )

  for (const [code, language] of Object.entries(LOCALES)) {
    if (code === SOURCE_LOCALE) continue
    const file = path.join(I18N_DIR, `${code}.json`)
    if (!fs.existsSync(file)) {
      console.log(`[i18n] skip ${code} — file missing`)
      continue
    }
    const data = readJson(file)
    const missing: KeyValue[] = []
    for (const key of targetKeys) {
      if (typeof data[key] !== 'string') {
        missing.push({ key, source: sourceData[key]! })
      }
    }
    if (missing.length === 0) {
      console.log(`[i18n] ${code} (${language}) — already complete`)
      continue
    }
    console.log(
      `[i18n] ${code} (${language}) — translating ${missing.length} keys`
    )
    try {
      const translations = await translateBatch(missing, language)
      let added = 0
      for (const m of missing) {
        const v = translations[m.key]
        if (typeof v === 'string' && v.length > 0) {
          data[m.key] = v
          added++
        }
      }
      writeJson(file, data)
      console.log(`[i18n] ${code} — wrote ${added}/${missing.length} keys`)
    } catch (error) {
      console.error(`[i18n] ${code} translation failed:`, error)
    }
  }

  console.log('[i18n] done')
}

main().catch(err => {
  console.error('[i18n] fatal:', err)
  process.exit(1)
})
