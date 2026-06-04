/**
 * Word count + estimated reading time for the document editor footer.
 *
 * Tiptap's `@tiptap/extension-character-count` gives us a robust character
 * count, but its `words()` splits on whitespace — which collapses an entire
 * CJK paragraph (no spaces) into ~1 word and makes reading time wildly wrong
 * for Chinese/Japanese text. Lumo is CJK-primary, so we derive words and
 * reading time ourselves from the editor's plain text:
 *
 *   - each scriptio-continua CJK character (Chinese / Japanese kana) counts as
 *     one "word" and is read at ~300 chars/min
 *   - runs of letters/digits count as one word each, read at ~200 wpm — this
 *     covers latin AND space-delimited scripts like Korean and Cyrillic
 *
 * Character count for display still comes from the extension; this module only
 * owns the CJK-aware word + reading-time math.
 */

/**
 * Scriptio-continua ranges (no inter-word spaces) where each character is read
 * as one unit: Hiragana, Katakana, CJK Ext-A, CJK Unified, CJK Compatibility
 * Ideographs. Hangul is intentionally excluded — Korean is space-delimited, so
 * it counts through the word path below.
 */
const CJK_CHAR =
  /[぀-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/gu

/** A "word": a run of letters/digits, keeping in-word apostrophes. */
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu

const CJK_CHARS_PER_MINUTE = 300
const WORDS_PER_MINUTE = 200

export interface ReadingStats {
  /** CJK characters + space-delimited words. */
  words: number
  /** Estimated minutes to read; 0 for empty content, otherwise at least 1. */
  readingMinutes: number
}

/** Stats shown in the document footer; `characters` comes from the extension. */
export interface EditorStats extends ReadingStats {
  characters: number
}

export function computeReadingStats(text: string): ReadingStats {
  const cjkChars = (text.match(CJK_CHAR) ?? []).length
  // Strip CJK before matching words so an ideograph adjacent to latin text
  // can't merge into a neighbouring word.
  const words = (text.replace(CJK_CHAR, ' ').match(WORD) ?? []).length

  const totalWords = cjkChars + words
  const minutes = cjkChars / CJK_CHARS_PER_MINUTE + words / WORDS_PER_MINUTE
  const readingMinutes = totalWords === 0 ? 0 : Math.max(1, Math.ceil(minutes))

  return { words: totalWords, readingMinutes }
}
