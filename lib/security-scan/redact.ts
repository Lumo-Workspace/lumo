/**
 * PURE — redaction, fingerprinting and entropy helpers (LUM-732).
 *
 * The raw secret value only ever exists in memory inside the scanner; these
 * helpers are what make it safe to persist a finding.
 */
import { createHash } from 'node:crypto'

/**
 * "AKIA…(len 20)" for values ≥ 8 chars — first 4 chars + length, never more.
 * Below 8 chars even a 4-char prefix would disclose most of the value (e.g.
 * a 5-char password sliced to 4 leaves only one character hidden), so short
 * values are redacted to just their length: "…(len 3)".
 */
export function redactSecret(value: string): string {
  if (value.length < 8) return `…(len ${value.length})`
  return `${value.slice(0, 4)}…(len ${value.length})`
}

/** Replace every occurrence of `value` in `line` with its redaction. */
export function redactLine(line: string, value: string): string {
  if (!value) return line
  return line.split(value).join(redactSecret(value))
}

/**
 * The marker `redactSecret` appends: `…(len N)` — deliberately *excludes*
 * the optional ≤ 4-char prefix that precedes it in a real redaction token.
 * Blanking the prefix along with the marker would eat up to 4 real chars of
 * whatever sits beside the token — enough to shrink an 8-char run below the
 * exemption's own threshold and hide it (see `isRedactionOnlyContent`).
 * `REDACTION_TOKEN_RE` (global) drives the blank-out pass; the non-global
 * clone `REDACTION_TOKEN_TEST_RE` drives the plain "does this span contain a
 * token at all" check, so that check is never corrupted by the global
 * clone's leftover `lastIndex` from a previous call.
 */
const REDACTION_TOKEN_RE = /…\(len \d+\)/g
const REDACTION_TOKEN_TEST_RE = /…\(len \d+\)/

const QUOTE_CHARS = ['"', "'", '`'] as const

/** Shortest quoted content still redacted as a prefix + length, see `redactSecret`. */
const MIN_QUOTED_LEN = 8

/**
 * A run of `MIN_QUOTED_LEN`+ non-whitespace chars — the shape of a
 * credential surviving in a span once its redaction tokens are blanked out.
 * Hoisted so `isRedactionOnlyContent` doesn't rebuild it on every call.
 */
const LONG_RUN_RE = new RegExp(`\\S{${MIN_QUOTED_LEN},}`)

/**
 * A token together with its ≤4-char non-whitespace, non-quote prefix — the
 * whole slice `redactSecret` could have produced from a real value abutting
 * the token with no gap. Used by the total-count gate to strip that slice
 * down to nothing rather than to a blanking space (see `isRedactionOnlyContent`).
 */
const TOKEN_WITH_PREFIX_RE = new RegExp(`[^\\s"'\`]{0,4}…\\(len \\d+\\)`, 'g')

/**
 * Defensive redaction for LLM-produced evidence, where we do not know which
 * substring is the secret: every quoted string of ≥ 8 chars is redacted.
 *
 * Implemented as a SINGLE left-to-right tokenizer rather than one regex pass
 * per quote style. Three independent passes can only ever approximate the
 * pairing, and every approximation failed OPEN — an odd number of a quote
 * char (an escaped quote `\'`, a prose apostrophe in `don't`, an
 * unterminated `"`) shifted the pairing by one, so the pass consumed the
 * text *between* two credentials and left the credential itself unquoted and
 * raw.
 *
 * The tokenizer:
 * - outside a span, any of `"`, `'`, `` ` `` opens a span of that style;
 * - inside a span, a backslash escapes the next char, the same quote char
 *   closes the span, and the other quote chars are plain content;
 * - on close, content of ≥ `MIN_QUOTED_LEN` chars is replaced by its
 *   redaction; shorter content is emitted verbatim (so `"hi"` survives);
 * - content that is *nothing but* redaction tokens (plus short filler) is
 *   emitted verbatim — without this, evidence that `redactAll` already
 *   redacted gets redacted a second time and reports the redaction's own
 *   length (`"AKIA…(len 20)"` → `"AKIA…(len 13)"`). The exemption is
 *   deliberately narrow: merely *containing* a marker must not exempt, since
 *   `scanSecrets` builds evidence as `maskQuotedValues(redactAll(…))` and so
 *   plants a marker inside the span itself — a span holding a detected
 *   secret plus an undetected one would then pass the second through raw
 *   (`"postgres://u:hunt…(len 13)@h/d?t=correcthorsebattery"`). An author
 *   writing the literal marker into their own string could shield it the
 *   same way. When the exemption does not apply the whole span collapses, so
 *   the reported length is the span's own — honest, if less contextful.
 *
 * Unpaired opener (odd count) — the fail-CLOSED half:
 * - an opener with no closer masks everything from the opener to the end of
 *   the string, regardless of length: an unterminated quote is exactly the
 *   case where a value straddles a truncation cap, and the marker exemption
 *   does not apply because the unscanned tail may hold anything;
 * - an unpaired opener also means our earlier pairing for that style was a
 *   guess (with `// don't commit; const pw = 'secret'`, left-to-right pairs
 *   the apostrophe with the credential's OPENING quote and leaves the
 *   credential outside any span). So when the unpaired opener is not the
 *   first delimiter of its style, the whole region from that first
 *   delimiter to the end of the string is masked instead — the prefix before
 *   it holds no quote of that style and is re-masked recursively, which
 *   terminates because each recursion strictly drops quote characters.
 */
export function maskQuotedValues(line: string): string {
  return maskQuotedSpans(line, () => true)
}

/**
 * LUM-1013 — the free-text variant of `maskQuotedValues`, for prose an LLM
 * authored about the code (AI-review title / detail / evidence, verifier
 * reason). The blanket pass masks every quoted span of 8+ chars, which is
 * right for a line where a secret was already detected and wrong for review
 * prose: `labelled 'Verification'` and `className='grid gap-2 …'` reached the
 * Record tab as `'Veri…(len 12)'`.
 *
 * Same tokenizer and the same fail-closed rules (unpaired opener, marker
 * spans); only the decision for a CLOSED span of 8+ chars differs. It is
 * still masked when ANY of these holds:
 * - the text uses credential vocabulary anywhere (`password`, `pw`, `secret`,
 *   `token`, `api key`, `bearer`, `auth` … see `CREDENTIAL_VOCAB_RE`) — then
 *   every quoted span is masked exactly as `maskQuotedValues` would, so
 *   `the password is "correct horse battery staple"` stays hidden;
 * - the span holds a redaction marker (a registry hit) — it may hide a
 *   second, undetected value beside it;
 * - any whitespace-separated piece of the span is credential-shaped
 *   (`isCredentialShapedToken`): letters and digits mixed inside one run,
 *   the shape of a generated token, a hex digest or a `hunter2`-style
 *   password.
 *
 * Residual, honestly named: a quoted value with no digits in a sentence with
 * no credential words (`const motto = 'correcthorsebattery'` quoted back by
 * the model) is now kept. Registry shapes are unaffected — they are redacted
 * before this pass runs.
 */
export function maskQuotedCredentials(text: string): string {
  if (CREDENTIAL_VOCAB_RE.test(normalizeVocab(text))) {
    return maskQuotedValues(text)
  }
  return maskQuotedSpans(
    text,
    content =>
      REDACTION_TOKEN_TEST_RE.test(content) ||
      content.split(/\s+/).some(isCredentialShapedToken)
  )
}

/**
 * Credential words, matched on `normalizeVocab` output so `apiKey`,
 * `API_KEY` and `api-key` all read as `api key`. Plain `key` is deliberately
 * absent: React reviews say "key" constantly.
 */
const CREDENTIAL_VOCAB_RE =
  /\b(?:pass(?:words?|wd|phrases?|codes?)?|pwd|pw|secrets?|tokens?|credentials?|api ?keys?|private keys?|access keys?|bearer|authorization|auth)\b/

function normalizeVocab(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
}

/** Shortest mixed letters+digits run read as credential-shaped (`hunter2`-length passwords). */
const MIN_MIXED_RUN = 6

/**
 * A piece of a quoted span that reads as a generated value: 8+ chars holding
 * one alphanumeric run of `MIN_MIXED_RUN`+ chars that mixes letters and
 * digits (`Zx9Qw3Lp…`, `hunter2isgood`, a hex digest). Identifiers with a
 * numeric suffix split on punctuation first (`LUM-1011`, `grid-cols-2`,
 * `mt-0.5`), so their runs are pure letters or pure digits and pass.
 */
function isCredentialShapedToken(token: string): boolean {
  if (token.length < MIN_QUOTED_LEN) return false
  return token
    .split(/[^A-Za-z0-9]+/)
    .some(
      run =>
        run.length >= MIN_MIXED_RUN && /[A-Za-z]/.test(run) && /\d/.test(run)
    )
}

/**
 * The tokenizer behind both passes; `shouldMask` decides only for a closed
 * span of `MIN_QUOTED_LEN`+ chars that is not redaction-only. Unpaired
 * openers are masked regardless of `shouldMask` (fail closed).
 */
function maskQuotedSpans(
  line: string,
  shouldMask: (content: string) => boolean
): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (!isQuoteChar(ch) || isContractionApostrophe(line, i)) {
      out += ch
      i += 1
      continue
    }
    const close = findClosingQuote(line, i, ch)
    if (close === -1) {
      // `indexOf` also finds a skipped contraction apostrophe, so a skip
      // that leaves the pairing odd still masks from that apostrophe on.
      const firstIdx = line.indexOf(ch)
      // Ambiguous pairing: fall back to masking the whole region.
      if (firstIdx < i) {
        return `${maskQuotedSpans(line.slice(0, firstIdx), shouldMask)}${maskOpenTail(ch, line.slice(firstIdx + 1))}`
      }
      return `${out}${maskOpenTail(ch, line.slice(i + 1))}`
    }
    const content = line.slice(i + 1, close)
    out +=
      content.length >= MIN_QUOTED_LEN &&
      !isRedactionOnlyContent(content) &&
      shouldMask(content)
        ? `${ch}${redactSecret(content)}${ch}`
        : line.slice(i, close + 1)
    i = close + 1
  }
  return out
}

/** Python / SQL string-literal prefixes a quote may follow: `b'…'`, `rb'…'`, `X'…'`. */
const STRING_PREFIX_RE = /^(?:[bBrRfFuU]{1,2})$/

/**
 * LUM-1013 — a `'` between a word and a contraction suffix (`row's`,
 * `don't`, `we're`, `I'm`) is an apostrophe, not an opener. Read as an
 * opener it paired with the next quote or, unpaired, masked the whole rest
 * of the text (`The row's ph…(len 364)`). Narrow on purpose: the word before
 * must be 2+ letters (or `I`) and not a string-literal prefix, and the
 * suffix must end the word, so `b's3cret…'` / `X'deadbeef'` still open a
 * span. Only consulted outside a span — inside one, the quote closes it.
 */
function isContractionApostrophe(line: string, idx: number): boolean {
  if (line[idx] !== "'") return false
  const word = /[A-Za-z]+$/.exec(line.slice(0, idx))?.[0]
  if (!word || (word !== 'I' && word.length < 2) || STRING_PREFIX_RE.test(word))
    return false
  return /^(?:s|t|re|ve|ll|d|m)(?![A-Za-z0-9_])/i.test(line.slice(idx + 1))
}

/**
 * True when the span content carries no credential-shaped remainder once its
 * redaction tokens are accounted for. A span with no token at all is never
 * exempt, however short — that is the caller's whole point in calling this,
 * so `false` short-circuits before either gate below runs. Both gates must
 * pass; either alone lets a credential through:
 *
 * Gate 1 — contiguous-run bound. Blank each token (marker only, not its
 * prefix) to a single space and check no run of `MIN_QUOTED_LEN`+
 * non-whitespace characters survives. This bounds a value glued directly to
 * the token with no gap: `abcdefghijk…(len 5)` → `abcdefghijk ` still holds
 * an 11-char run beside the prefix-less token, so it fails here and is
 * redacted. Blanking to a space rather than stripping the token outright is
 * what makes the bound hold — the token match excludes the prefix (see
 * `REDACTION_TOKEN_RE`), so stripping to `''` could otherwise splice two
 * unrelated runs together across the gap where the token used to be.
 *
 * Gate 2 — total-count bound. This is the gate the run test alone cannot
 * provide: a credential can sit in the *same* span as a detected token but
 * separated from it by whitespace — `AKIA…(len 20) correct horse battery
 * staple` has no single run ≥ `MIN_QUOTED_LEN` (gate 1 passes it clean) yet
 * the passphrase is fully readable. Strip every token *together with* its
 * ≤4-char prefix (`TOKEN_WITH_PREFIX_RE`, stripped to `''` this time — there
 * is no adjacent-run risk once gate 1 has already run) and count what is
 * left, ignoring whitespace: `< MIN_QUOTED_LEN` exempts, otherwise redacted.
 *
 * `AKIA…(len 20)` → gate 1 keeps only the 4-char prefix (pass); gate 2
 * strips to `''`, count 0 (pass) → exempt.
 * `a "SUPE…(len 22)" b` → gate 1's longest run is 5 chars (pass); gate 2
 * strips the token+prefix, leaving only the punctuation and letters outside
 * it, well under 8 (pass) → exempt.
 * `abcdefghijk…(len 5)` → gate 1 fails outright (11-char run) → redacted;
 * gate 2 is never reached.
 * `AKIA…(len 20) correct horse battery staple` → gate 1 passes (no single
 * run ≥ 8, the passphrase is whitespace-broken); gate 2 strips the token,
 * leaving the passphrase's ~25 non-whitespace characters — well over the
 * threshold (fail) → redacted. This is the case gate 1 alone got wrong.
 *
 * Residual, honestly named: this function only ever runs on content that
 * already sits inside a quoted span found by `maskQuotedValues`'s tokenizer.
 * A whitespace-separated credential written as unquoted prose — outside any
 * span — is out of that tokenizer's contract entirely and is not touched by
 * either gate here; catching it is `redactAll`'s / the pattern registry's
 * job, not this exemption's.
 */
function isRedactionOnlyContent(content: string): boolean {
  if (!REDACTION_TOKEN_TEST_RE.test(content)) return false
  const blanked = content.replace(REDACTION_TOKEN_RE, ' ')
  if (LONG_RUN_RE.test(blanked)) return false
  const stripped = content.replace(TOKEN_WITH_PREFIX_RE, '')
  const remainingCount = stripped.replace(/\s/g, '').length
  return remainingCount < MIN_QUOTED_LEN
}

function isQuoteChar(ch: string): ch is (typeof QUOTE_CHARS)[number] {
  return (QUOTE_CHARS as readonly string[]).includes(ch)
}

/** Index of the closing `quote`, honouring backslash escapes; -1 when unpaired. */
function findClosingQuote(
  line: string,
  openIdx: number,
  quote: string
): number {
  let i = openIdx + 1
  while (i < line.length) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 2
      continue
    }
    if (ch === quote) return i
    i += 1
  }
  return -1
}

/** An unterminated quoted tail is always masked — never emitted raw. */
function maskOpenTail(quote: string, tail: string): string {
  return `${quote}${redactSecret(tail)}`
}

export function secretFingerprint(ruleId: string, rawValue: string): string {
  return createHash('sha256')
    .update(`${ruleId}:${rawValue}`)
    .digest('hex')
    .slice(0, 16)
}

export function vulnerabilityFingerprint(
  ruleId: string,
  filePath: string,
  title: string
): string {
  const normalized = title.toLowerCase().trim().replace(/\s+/g, ' ')
  return createHash('sha256')
    .update(`${ruleId}:${filePath}:${normalized}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * LUM-988 — fingerprint for an AI-review (LLM_JUDGE) finding. Keyed on the
 * added line the model quoted as evidence, not on its title: the title is
 * free text the model re-words on every push, so a title key gave the same
 * problem a new fingerprint each scan — its inline comment was posted again
 * and a human's FALSE_POSITIVE was not inherited. The evidence line is
 * customer code, so it only changes when the code does. Whitespace is
 * normalised like `sarifFingerprint`; an empty evidence line falls back to
 * the title key rather than collapsing every such finding in a file into one.
 * Pass the REDACTED evidence, so the key is reproducible from the stored row.
 */
export function judgeFindingFingerprint(
  ruleId: string,
  filePath: string,
  evidence: string,
  title: string
): string {
  const line = evidence.replace(/\s+/g, ' ').trim()
  if (line.length === 0)
    return vulnerabilityFingerprint(ruleId, filePath, title)
  return createHash('sha256')
    .update(`${ruleId}:${filePath}:evidence:${line}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * LUM-735 — fingerprint for a SARIF-sourced finding when the tool gave no
 * `partialFingerprints.primaryLocationLineHash`. Whitespace-normalised
 * snippet so a reformat keeps the human's disposition across pushes.
 */
export function sarifFingerprint(
  ruleId: string,
  filePath: string,
  snippet: string
): string {
  const normalized = snippet.replace(/\s+/g, ' ').trim()
  return createHash('sha256')
    .update(`${ruleId}:${filePath}:${normalized}`)
    .digest('hex')
    .slice(0, 16)
}

/**
 * LUM-738 — identity of one vulnerable dependency, independent of where in
 * the lockfile (or on which push) it was reported: the same package at the
 * same version with the same advisory keeps one fingerprint across pushes and
 * across the default-branch baseline, so dispositions inherit and baseline
 * membership is meaningful. Same 16-hex truncation as the other fingerprints.
 */
export function dependencyFingerprint(
  ecosystem: string,
  name: string,
  version: string,
  osvId: string
): string {
  return createHash('sha256')
    .update(`${ecosystem}:${name}:${version}:${osvId}`)
    .digest('hex')
    .slice(0, 16)
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  let h = 0
  for (const n of counts.values()) {
    const p = n / s.length
    h -= p * Math.log2(p)
  }
  return h
}
