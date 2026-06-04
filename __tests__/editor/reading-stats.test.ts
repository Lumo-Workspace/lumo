import { computeReadingStats } from '@/lib/editor/reading-stats'

describe('computeReadingStats', () => {
  it('returns zeros for an empty string', () => {
    expect(computeReadingStats('')).toEqual({ words: 0, readingMinutes: 0 })
  })

  it('returns zeros for whitespace-only text', () => {
    expect(computeReadingStats('   \n\t  ')).toEqual({
      words: 0,
      readingMinutes: 0,
    })
  })

  it('ignores punctuation-only tokens', () => {
    expect(computeReadingStats('!!! ... ——')).toEqual({
      words: 0,
      readingMinutes: 0,
    })
  })

  it('counts latin words split on whitespace', () => {
    const { words } = computeReadingStats('hello world from lumo')
    expect(words).toBe(4)
  })

  it('treats a contraction as a single word', () => {
    const { words } = computeReadingStats("don't stop")
    expect(words).toBe(2)
  })

  it('counts each CJK character as one word', () => {
    const { words } = computeReadingStats('你好世界')
    expect(words).toBe(4)
  })

  it('counts mixed CJK + latin correctly', () => {
    // 2 CJK chars + 2 latin words
    const { words } = computeReadingStats('你好 hello world')
    expect(words).toBe(4)
  })

  it('does not count emoji as words', () => {
    expect(computeReadingStats('👍🎉')).toEqual({ words: 0, readingMinutes: 0 })
  })

  it('counts Korean by whitespace, not per syllable', () => {
    // Korean is space-delimited; "안녕하세요 세계" is 2 words, not 8 syllables.
    expect(computeReadingStats('안녕하세요 세계').words).toBe(2)
  })

  it('counts Japanese kana per character', () => {
    // Japanese has no spaces — each kana/kanji is one unit.
    expect(computeReadingStats('こんにちは').words).toBe(5)
  })

  it('rounds latin reading time up at ~200 wpm', () => {
    const text = Array.from({ length: 400 }, () => 'word').join(' ')
    // 400 / 200 = 2 minutes exactly
    expect(computeReadingStats(text).readingMinutes).toBe(2)
  })

  it('rounds CJK reading time up at ~300 chars/min', () => {
    const text = '字'.repeat(600)
    // 600 / 300 = 2 minutes exactly
    expect(computeReadingStats(text).readingMinutes).toBe(2)
  })

  it('clamps any non-empty content to a minimum of 1 minute', () => {
    expect(computeReadingStats('hi').readingMinutes).toBe(1)
    expect(computeReadingStats('你好').readingMinutes).toBe(1)
  })

  it('blends CJK and latin rates for mixed content', () => {
    // 300 CJK chars (=1.0 min) + 200 latin words (=1.0 min) = 2.0 min
    const cjk = '字'.repeat(300)
    const latin = Array.from({ length: 200 }, () => 'w').join(' ')
    expect(computeReadingStats(`${cjk} ${latin}`).readingMinutes).toBe(2)
  })
})
