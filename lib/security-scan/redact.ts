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
  return maskQuotedSpans(line, MASK_EVERY_SPAN, false)
}

const MASK_EVERY_SPAN = (): boolean => true

/**
 * LUM-1013 — the free-text variant of `maskQuotedValues`, for prose an LLM
 * authored about the code (AI-review title / detail / evidence, verifier
 * reason). The blanket pass masks every quoted span of 8+ chars, which is
 * right for a line where a secret was already detected and wrong for review
 * prose: `labelled 'Verification'` and `className='grid gap-2 …'` reached the
 * Record tab as `'Veri…(len 12)'`.
 *
 * Same tokenizer and the same fail-closed rules (unpaired opener, marker
 * spans), with two differences. A contraction apostrophe (`row's`) does not
 * open a span (`isContractionApostrophe`) — only here: the blanket pass stays
 * byte-identical, because AI-review fingerprints are keyed on its output.
 * And a CLOSED span of 8+ chars is still masked only when ANY of these holds:
 * - the text uses credential vocabulary anywhere (`password`, `pw`, `secret`,
 *   `token`, `api key`, `signing key`, `bearer`, `auth` … see
 *   `CREDENTIAL_VOCAB_RE`) — then every quoted span is masked, so
 *   `the password is "correct horse battery staple"` stays hidden;
 * - the span holds a redaction marker (a registry hit) — it may hide a
 *   second, undetected value beside it;
 * - any whitespace-separated piece of the span is credential-shaped
 *   (`isCredentialShapedToken`): a generated token, a base64 / dashed key,
 *   a hex digest or a `hunter2`-style password.
 *
 * Residual, honestly named: a quoted value with no digits in a sentence with
 * no credential words (`const motto = 'correcthorsebattery'` quoted back by
 * the model) is now kept. Registry shapes are unaffected — they are redacted
 * before this pass runs.
 */
export function maskQuotedCredentials(text: string): string {
  if (CREDENTIAL_VOCAB_RE.test(normalizeVocab(text))) {
    return maskQuotedSpans(text, MASK_EVERY_SPAN, true)
  }
  return maskQuotedSpans(
    text,
    content =>
      REDACTION_TOKEN_TEST_RE.test(content) ||
      content.split(/\s+/).some(isCredentialShapedToken),
    true
  )
}

/**
 * LUM-1200 — the narrowest quoted-span pass, for prose a model wrote about a
 * whole PR (the PR summary's intent and change bullets). `maskQuotedValues`
 * masked every quoted phrase of 8+ chars there — production rendered
 * `marked 'do not merge'` as `marked 'do n…(len 12)'` — and
 * `maskQuotedCredentials` would still mask every quoted phrase in any summary
 * that so much as mentions a token, which a summary of an auth change always
 * does. Same tokenizer and fail-closed rules (unpaired opener, marker spans,
 * contraction apostrophes); a CLOSED span of 8+ chars is masked only when:
 * - it holds a redaction marker (a registry hit) — see `maskQuotedCredentials`;
 * - any whitespace-separated piece of it is credential-shaped
 *   (`isCredentialShapedToken`); or
 * - it FOLLOWS a credential key: the text right before the opening quote ends
 *   in credential vocabulary plus at most two connectors (`password is "…"`,
 *   `token: '…'`, `API_KEY="…"`, `"password": "…"`, `the secret "…"`); or
 * - it ASSIGNS a credential key inside itself — quoted code such as
 *   `` `const pw = 'correcthorse'` `` (LUM-1200 follow-up: finding prose
 *   quotes code inline, so the key and its value can share one span). A key
 *   merely read (`token.length > 0`) is not an assignment and stays.
 * Residual, honestly named: a shapeless passphrase quoted further away from
 * its key (`the password, as before, is "…"`) is kept. Registry shapes are
 * redacted before this pass runs, as for the other two.
 */
export function maskQuotedKeyedValues(text: string): string {
  return maskQuotedSpans(
    text,
    (content, before) =>
      REDACTION_TOKEN_TEST_RE.test(content) ||
      content.split(/\s+/).some(isCredentialShapedToken) ||
      (CREDENTIAL_KEY_BEFORE_RE.test(normalizeVocab(before)) &&
        !isPlaceholderValue(content)) ||
      assignsCredentialValue(normalizeVocab(content)),
    true
  )
}

/** How far back from an opening quote `maskQuotedKeyedValues` looks for its key. */
const KEY_WINDOW = 48

/**
 * Credential words, matched on `normalizeVocab` output so `apiKey`,
 * `API_KEY` and `api-key` all read as `api key`. Plain `key` is deliberately
 * absent — React reviews say "key" constantly — so only the compounds that
 * name a credential count (`signing key`, `ssh key`, `license key` …); a
 * credential-shaped value next to a bare "key" is still masked by shape.
 */
const CREDENTIAL_VOCAB_SOURCE =
  '(?:pass(?:words?|wd|phrases?|codes?)?|pwd|pw|secrets?|tokens?|credentials?|bearer|authorization|auth|(?:api|private|access|secret|signing|encryption|decryption|master|license|licence|session|ssh|gpg|pgp|client|service|account|deploy|webhook|app) ?keys?)'
const CREDENTIAL_VOCAB_RE = new RegExp(`\\b${CREDENTIAL_VOCAB_SOURCE}\\b`)

/**
 * LUM-1200 — credential vocabulary ending the text before an opening quote,
 * optionally closed by its own quote (a JSON / dict key: `"password": "…"`),
 * followed by at most two connectors (`is`, `=`, `:`, `to` …) — the quote
 * then holds that credential's value. The bare words `pass` and `auth` are
 * ordinary prose (`make CI pass 'lint'`), so they count only before an
 * assignment (`pass: '…'`, `auth = "…"`). Matched on `normalizeVocab` output.
 */
const CREDENTIAL_KEY_SOURCE =
  '(?:pass(?:words?|wd|phrases?|codes?)|pwd|pw|secrets?|tokens?|credentials?|bearer|authorization|(?:api|private|access|secret|signing|encryption|decryption|master|license|licence|session|ssh|gpg|pgp|client|service|account|deploy|webhook|app) ?keys?)'
const CREDENTIAL_KEY_BEFORE_RE = new RegExp(
  `(?:\\b${CREDENTIAL_KEY_SOURCE}["'\`]?\\s*(?:(?:is|was|equals|of|to|as|=>|[=:,])\\s*){0,2}|\\b(?:pass|auth)["'\`]?\\s*(?:=>|[=:])\\s*)$`
)

/**
 * LUM-1200 follow-up — a credential key assigned inside a quoted span
 * (`pw = '…'`, `apiKey: "…"`, `password => …`); the bare `pass` / `auth`
 * count only here too, as in `CREDENTIAL_KEY_BEFORE_RE`. A comparison
 * (`token == x`, `token >= 0`) or a property read (`token.length`) is not
 * an assignment.
 */
const CREDENTIAL_KEY_ASSIGNED_RE = new RegExp(
  `\\b(?:${CREDENTIAL_KEY_SOURCE}|pass|auth)["'\`]?\\s*(?:=>|=(?!=)|:)`
)

function normalizeVocab(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .toLowerCase()
}

/**
 * LUM-1200 follow-up #2 — a value that stands for one rather than being one:
 * an ellipsis (`token=...`), a run of `x` / `*`, nothing at all, or a
 * NAMED placeholder — `<your token>`, `{token}`, `${API_KEY}`, `$TOKEN` —
 * whose name is short words only (no digits) and says what it stands for
 * (credential vocabulary, or `your` / `value` / `here` …). Production (probe
 * PR 63): the linked requirement `` `GET /session/check?token=...` ``
 * rendered as `` `GET …(len 28)` `` in the PR summary. A bracketed or
 * `$`-prefixed value that does not name itself (`<correcthorse>`,
 * `$hunter two`) is not a placeholder.
 */
const PLACEHOLDER_FILLER_RE = /^(?:\.{2,}|…+|x{3,}|\*{3,}|)$/i
const NAMED_PLACEHOLDER_RE =
  /^(?:<([^<>]*)>|\$?\{\{?([^{}]*?)\}?\}|\$([A-Za-z_][A-Za-z0-9_]*))$/
const PLACEHOLDER_NAME_RE = /^[A-Za-z _.-]{1,40}$/
const PLACEHOLDER_WORD_RE =
  /\b(?:your|my|value|here|placeholder|redacted|example|insert|name)\b/

function isPlaceholderValue(value: string): boolean {
  const v = value.trim().replace(/^["'`]|["'`]$/g, '')
  if (PLACEHOLDER_FILLER_RE.test(v)) return true
  const m = NAMED_PLACEHOLDER_RE.exec(v)
  const name = m?.[1] ?? m?.[2] ?? m?.[3]
  if (name === undefined || !PLACEHOLDER_NAME_RE.test(name.trim())) return false
  const words = normalizeVocab(name)
  return CREDENTIAL_VOCAB_RE.test(words) || PLACEHOLDER_WORD_RE.test(words)
}

/**
 * `CREDENTIAL_KEY_ASSIGNED_RE` with the assigned value captured — a quoted
 * value whole (so `"<a> realsecret"` is read as one value, not as `"<a>`),
 * else up to the next separator: a span assigning a credential key masks
 * unless every value it assigns is a placeholder (`isPlaceholderValue`) —
 * `?token=...` renders, `?token=abc` and `pw = 'correcthorse'` are masked.
 */
const CREDENTIAL_KEY_ASSIGNED_VALUE_RE = new RegExp(
  `${CREDENTIAL_KEY_ASSIGNED_RE.source}\\s*("[^"]*"|'[^']*'|<[^>]*>|\\$?\\{[^}]*\\}|[^\\s&,;)\\]}]*)`,
  'g'
)

function assignsCredentialValue(content: string): boolean {
  for (const m of content.matchAll(CREDENTIAL_KEY_ASSIGNED_VALUE_RE))
    if (!isPlaceholderValue(m[1] ?? '')) return true
  return false
}

/** Shortest mixed letters+digits run read as credential-shaped (`hunter2`-length passwords). */
const MIN_MIXED_RUN = 6

/** Shortest base64 / dashed key read as credential-shaped as a whole. */
const MIN_KEY_LEN = 16

/** The base64 / base64url / dashed-key alphabet, and nothing else. */
const KEY_ALPHABET_RE = /^[A-Za-z0-9+/=_-]+$/

/** Sentence punctuation that can wrap a value inside a span: `(…)`, `…,`. */
const WRAPPING_PUNCT_RE = /^[([{<,;:!?.]+|[)\]}>,;:!?.]+$/g

/**
 * A piece of a quoted span that reads as a generated value, 8+ chars and:
 * - one alphanumeric run of `MIN_MIXED_RUN`+ chars mixing letters and digits
 *   (`Zx9Qw3Lp…`, `hunter2isgood`, a hex digest); or
 * - as a WHOLE, `MIN_KEY_LEN`+ chars of the base64 / dashed-key alphabet
 *   holding both letters and digits, so a key whose punctuation splits it
 *   into pure runs (`sk-live-abcDEF/ghiJKL+123`, `AbCd-1234-EfGh-5678`) is
 *   still caught.
 * Identifiers with a numeric part (`LUM-1011`, `grid-cols-2`, `mt-0.5`,
 * `grid-cols-[1fr_auto]`) are short or carry characters outside the key
 * alphabet, so they pass.
 */
function isCredentialShapedToken(raw: string): boolean {
  const token = raw.replace(WRAPPING_PUNCT_RE, '')
  if (token.length < MIN_QUOTED_LEN) return false
  if (
    token.length >= MIN_KEY_LEN &&
    KEY_ALPHABET_RE.test(token) &&
    /[A-Za-z]/.test(token) &&
    /\d/.test(token)
  )
    return true
  return token
    .split(/[^A-Za-z0-9]+/)
    .some(
      run =>
        run.length >= MIN_MIXED_RUN && /[A-Za-z]/.test(run) && /\d/.test(run)
    )
}

/**
 * The tokenizer behind every pass; `shouldMask` decides only for a closed
 * span of `MIN_QUOTED_LEN`+ chars that is not redaction-only, given the
 * span's content and the `KEY_WINDOW` chars before its opening quote. Unpaired
 * openers are masked regardless of `shouldMask` (fail closed).
 * `skipContractions` is the free-text pass's `isContractionApostrophe` rule.
 */
function maskQuotedSpans(
  line: string,
  shouldMask: (content: string, before: string) => boolean,
  skipContractions: boolean
): string {
  let out = ''
  let i = 0
  while (i < line.length) {
    const ch = line[i]!
    if (
      !isQuoteChar(ch) ||
      (skipContractions && isContractionApostrophe(line, i))
    ) {
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
        return `${maskQuotedSpans(line.slice(0, firstIdx), shouldMask, skipContractions)}${maskOpenTail(ch, line.slice(firstIdx + 1))}`
      }
      return `${out}${maskOpenTail(ch, line.slice(i + 1))}`
    }
    const content = line.slice(i + 1, close)
    out +=
      content.length >= MIN_QUOTED_LEN &&
      !isRedactionOnlyContent(content) &&
      shouldMask(content, line.slice(Math.max(0, i - KEY_WINDOW), i))
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
