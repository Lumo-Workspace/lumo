import { FAST_MODEL } from '@/lib/ai/models'
import { logger } from '@/lib/logger'
import {
  parseMemoryContent,
  trapContentSchema,
  decisionContentSchema,
  conventionContentSchema,
  proceduralContentSchema,
} from '@/lib/memory/schemas'
import { memoryContentToText } from '@/lib/memory/content-text'
import type { MemoryCategory } from '@prisma/client'
import type { MemoryContent } from '@/lib/memory/schemas'
import type { z } from 'zod'

/** deepseek-v4-flash via the gateway — same model as the auto reconcile path. */
const MODEL_ID = FAST_MODEL

const schemaByCategory: Record<MemoryCategory, z.ZodTypeAny> = {
  TRAP: trapContentSchema,
  DECISION: decisionContentSchema,
  CONVENTION: conventionContentSchema,
  PROCEDURAL: proceduralContentSchema,
}

/**
 * CJK detection. Lumo's store is bilingual EN/ZH; CJK presence is the reliable
 * "needs translation" discriminator (a pure-ASCII heuristic would misfire on
 * accented English, but the real-world non-English content here is Chinese).
 * Covers CJK Unified Ideographs + common punctuation/Hiragana/Katakana ranges.
 * Korean Hangul (U+AC00–U+D7AF) and CJK Extension B+ (U+20000+) are deliberately
 * NOT included — the store is EN/ZH only.
 */
export function containsCjk(text: string): boolean {
  return /[　-〿぀-ヿ㐀-䶿一-鿿豈-﫿＀-￯]/.test(text)
}

/**
 * Normalize a structured memory content object to English (LUM-336). If the
 * flattened text contains no CJK, the content is assumed already-English and
 * returned unchanged with NO LLM call. Otherwise an LLM translates each string
 * field to English while preserving the per-category schema shape and keys; the
 * result is re-validated via parseMemoryContent.
 *
 * fail-open: any failure (no key / gateway down / invalid translation) returns
 * the ORIGINAL content unchanged. A manual write must never be lost or blocked
 * by a translation failure.
 *
 * The gateway is dynamic-imported INSIDE the function so static-importing this
 * module stays jest-safe (the real @ai-sdk/gateway crashes jest via
 * TransformStream).
 */
export async function canonicalizeToEnglish(
  category: MemoryCategory,
  content: MemoryContent | unknown
  // Returns `unknown` (not MemoryContent): translated output is re-validated by
  // the caller via parseMemoryContent; on fail-open the original (possibly
  // non-English) content is returned verbatim.
): Promise<unknown> {
  const text = memoryContentToText(category, content)
  if (!text || !containsCjk(text)) return content
  try {
    const { generateObject } = await import('ai')
    const { gateway } = await import('@/lib/ai/gateway')
    const { object } = await generateObject({
      model: gateway(MODEL_ID),
      schema: schemaByCategory[category],
      system:
        'You translate structured developer-memory records into English. ' +
        'Translate the VALUE of every natural-language string field into clear, ' +
        'idiomatic English. Preserve the object shape and keys EXACTLY — do not ' +
        'add, drop, or rename keys. Keep code identifiers, file paths, command ' +
        'names, and proper nouns verbatim. If a value is already English, return ' +
        'it unchanged.',
      prompt: JSON.stringify(content),
    })
    // Re-validate against the strict per-category schema; on success return the
    // translated content, else fall through to the original.
    return parseMemoryContent(category, object)
  } catch (err) {
    logger.warn(
      `[memory.canonicalize] translation skipped for category=${category} — keeping original:`,
      err instanceof Error ? err.message : err
    )
    return content
  }
}
