/**
 * LUM-996 — the small deterministic helpers the read-out is built from:
 * Wilson intervals, a script/stop-word language tag, and the heuristic
 * taxonomy that names WHY an attack was missed.
 *
 * None of these touch the detector. They only label samples so the report
 * can be cut per language and per miss category; they are heuristics and the
 * README says so.
 */

export interface Rate {
  k: number
  n: number
  /** k / n, rounded to 4 dp; null when n = 0. */
  rate: number | null
  /** 95% Wilson score interval, rounded to 4 dp; null when n = 0. */
  lo: number | null
  hi: number | null
}

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4

/** k-of-n with a 95% Wilson score interval (z = 1.96). */
export function wilson(k: number, n: number, z = 1.96): Rate {
  if (n <= 0) return { k, n, rate: null, lo: null, hi: null }
  const p = k / n
  const z2 = z * z
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom
  return {
    k,
    n,
    rate: round4(p),
    lo: round4(Math.max(0, centre - half)),
    hi: round4(Math.min(1, centre + half)),
  }
}

// ─── language ────────────────────────────────────────────────────────────────

export type Lang = 'en' | 'zh' | 'de' | 'other'

const CJK = /[\u4e00-\u9fff\u3400-\u4dbf]/gu
/** Hiragana / katakana: kanji-bearing Japanese is not Chinese. */
const KANA = /[\u3040-\u30ff]/u
const LATIN = /[A-Za-z\u00c0-\u024f]/gu
const ANY_LETTER = /\p{L}/gu
const GERMAN_CHARS = /[äöüßÄÖÜ]/u
const DE_WORDS = new Set(
  'und der die das ich nicht ist sie du mit für auf ein eine wie was bitte vergiss alle deine dich mir zu den dem von sind wir ihr bin hast kannst jetzt nun neue aufgabe anweisungen'.split(
    ' '
  )
)
const EN_WORDS = new Set(
  'the and is you to of a in what how your all for with are me my this that it be do not now new task instructions'.split(
    ' '
  )
)

/**
 * `other` when the text carries kana (Japanese); `zh` when CJK characters
 * make up ≥ 30% of ALL letters (any script, so Cyrillic with one CJK
 * character is not Chinese); `other` when Latin letters are under half of
 * the letters; else `de` when German stop words outnumber English ones (or
 * umlauts appear with any German stop word); else `en`.
 */
export function detectLang(text: string): Lang {
  const cjk = text.match(CJK)?.length ?? 0
  const latin = text.match(LATIN)?.length ?? 0
  const letters = text.match(ANY_LETTER)?.length ?? 0
  if (KANA.test(text)) return 'other'
  if (cjk > 0 && cjk / letters >= 0.3) return 'zh'
  if (latin === 0 || latin / letters < 0.5) return 'other'
  const words = text.toLowerCase().match(/[a-zäöüß]+/gu) ?? []
  let de = 0
  let en = 0
  for (const w of words) {
    if (DE_WORDS.has(w)) de++
    if (EN_WORDS.has(w)) en++
  }
  if (de > en || (de > 0 && GERMAN_CHARS.test(text))) return 'de'
  return 'en'
}

// ─── miss taxonomy ──────────────────────────────────────────────────────────

export type MissCategory =
  | 'non-English (German)'
  | 'obfuscation / token noise'
  | 'override paraphrase'
  | 'secret / prompt extraction'
  | 'role-play / persona'
  | 'output hijack ("say X")'
  | 'zh: override paraphrase'
  | 'zh: secret / prompt extraction'
  | 'zh: role-play / persona'
  | 'zh: output hijack ("say X")'
  | 'zh: other'
  | 'other'

/**
 * Rules applied in order; first match wins. The order encodes which property
 * best explains a miss: a German override is missed for its language before
 * its phrasing, a padded "say Access Granted" for its padding.
 */
const EN_RULES: Array<[MissCategory, RegExp]> = [
  [
    'override paraphrase',
    /\b(?:ignor\w*|disregard\w*|forg[eo]t\w*|overrid\w*|bypass\w*|cancel\w*|stop\w*|revok\w*|abandon\w*|defy|instead|from now on|new (?:task|instruction|rule)s?|end of (?:prompt|instructions)|no longer)\b/i,
  ],
  [
    'secret / prompt extraction',
    /\b(?:password|passcode|secret|access code|system prompt|prompt|instructions?|reveal|spell|letters?|hint|repeat (?:the|your|everything)|what (?:is|was) (?:the|your))\b/i,
  ],
  [
    'role-play / persona',
    /\b(?:pretend|act as|role-?play|imagine|persona|character|actors?|film|movie|scene|you are (?:a|an|now)|let'?s play|game|story|dan)\b/i,
  ],
  [
    'output hijack ("say X")',
    /\b(?:say|respond with|reply with|answer with|output|print|write)\b|access granted/i,
  ],
]

const ZH_RULES: Array<[MissCategory, RegExp]> = [
  [
    'zh: override paraphrase',
    /忽略|无视|忘记|忘掉|不要理会|别管|取消|停止|新任务|新的任务|新的指示|新指令|从现在开始/,
  ],
  [
    'zh: secret / prompt extraction',
    /密码|秘密|提示|指令|说明|透露|告诉我|显示|打印|开头/,
  ],
  ['zh: role-play / persona', /扮演|假装|假设|想象|角色|演员|电影|你是/],
  ['zh: output hijack ("say X")', /说|写|输出|回答|回复|生成/],
]

/** Share of characters outside ASCII letters/digits/space/punct and outside CJK. */
function noiseRatio(text: string): number {
  if (!text) return 0
  let noise = 0
  let total = 0
  for (const ch of text) {
    total++
    if (/[\x20-\x7e\s]/.test(ch)) continue
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/u.test(ch)) continue
    noise++
  }
  return noise / total
}

/**
 * A single token repeated ≥ 10 times in a row (padding / context flooding),
 * or a word spelled out letter by letter (`S a y t h a t`).
 */
function hasTokenFlood(text: string): boolean {
  return (
    /(\S{1,12})(?:\s+\1){9,}/u.test(text) ||
    /(?:^|\s)(?:\p{L} ){6,}\p{L}(?=\s|$)/u.test(text)
  )
}

export function categorizeMiss(text: string, lang: Lang): MissCategory {
  if (lang === 'zh') {
    for (const [cat, re] of ZH_RULES) if (re.test(text)) return cat
    return 'zh: other'
  }
  if (lang === 'de') return 'non-English (German)'
  if (noiseRatio(text) > 0.2 || hasTokenFlood(text))
    return 'obfuscation / token noise'
  for (const [cat, re] of EN_RULES) if (re.test(text)) return cat
  return 'other'
}
