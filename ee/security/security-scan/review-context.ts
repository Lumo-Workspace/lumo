/**
 * LUM-988 — the PR-head content of the changed files, as context for the AI
 * review (`judgeSecurity`).
 *
 * The diff alone hides most of what a reviewer needs: the function a hunk
 * sits in, the caller a changed signature breaks, the comment the new code
 * contradicts. On the LUM-975 replay of the Martian Code Review Bench, adding
 * up to 100k chars of these files moved the review from F1 ~47 to ~53.
 *
 * Two halves:
 *   · `packReviewContext` — PURE: which files go in, in what order, under the
 *     char cap. Same rules the replay measured: no lockfiles / binaries /
 *     generated files, nothing over ~200 KB, source before tests, smallest
 *     first, skip-and-continue so one big file does not starve the rest.
 *   · `loadReviewContext` — reads the files through an injected reader (the
 *     service passes `readRepoFile`, which refuses an unconfirmed repository)
 *     and degrades to NO context on any failure. The review must still run on
 *     the diff: a context problem is ours, not a reason to skip the review.
 *
 * Redaction is the caller's job (`redactForInjection`), like the diff's, so
 * both halves of the prompt pass through the same mask at the same place.
 */

// LUM-1143: one lockfile list for the review input and its context.
import { LOCKFILE_PATH } from './reviewable-path'

/** Total chars of file content the review gets (the replay's number). */
export const REVIEW_CONTEXT_MAX_CHARS = 100_000

/**
 * LUM-988 — diff + context together never exceed this many chars: the top
 * diff tier's size, the largest prompt the timeouts were sized for. The
 * Martian replay measured this envelope (largest prompt 177.5k chars, slowest
 * call 42 s against 120–180 s timeouts); a top-tier diff plus a full 100k of
 * context (~280k) was never measured, so context gives way to the diff.
 */
export const REVIEW_PROMPT_MAX_CHARS = 180_000

/** Context chars left for a diff of `diffChars`: 0..REVIEW_CONTEXT_MAX_CHARS. */
export function reviewContextBudget(diffChars: number): number {
  return Math.max(
    0,
    Math.min(REVIEW_CONTEXT_MAX_CHARS, REVIEW_PROMPT_MAX_CHARS - diffChars)
  )
}

/** A file bigger than this is never context — it is generated or vendored, or too big to help. */
export const REVIEW_CONTEXT_MAX_FILE_CHARS = 200_000

/**
 * Files read per scan. Sizes are unknown before reading, so this bounds the
 * GitHub calls on a wide PR; source files are read first.
 */
export const REVIEW_CONTEXT_MAX_READS = 60

export const REVIEW_CONTEXT_READ_CONCURRENCY = 8

/**
 * Wall-clock budget for all reads. The judge call after it has up to 180 s
 * and the worker is capped at 300 s, so context may not eat into either.
 */
export const REVIEW_CONTEXT_TIMEOUT_MS = 20_000

const GENERATED_OR_BINARY =
  /\.(min\.js|min\.css|map|snap|lock|svg|png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|wasm|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|wav|ogg|pyc|o|a)$/i
const TEST_PATH =
  /(^|\/)(__tests__|__mocks__|tests?|spec|specs|fixtures?)\/|\.(test|spec)\.[a-z0-9]+$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$/

/** Never context: lockfiles, binaries, minified / generated output. */
export function isSkippedContextPath(path: string): boolean {
  return LOCKFILE_PATH.test(path) || GENERATED_OR_BINARY.test(path)
}

/** Test and fixture files go after source: they explain less of the change. */
export function isTestPath(path: string): boolean {
  return TEST_PATH.test(path)
}

export interface ContextFile {
  path: string
  body: string
}

export interface PackedReviewContext {
  /** What goes after the diff in the prompt; '' when nothing fit. */
  text: string
  /** Paths packed, in prompt order. */
  included: string[]
  /**
   * LUM-1150 — each packed file's content by path (the suggestion scope
   * check). Kept apart from `text`: a body may contain a line shaped like
   * another file's `=== path ===` header, so `text` cannot be split back.
   */
  bodies?: Readonly<Record<string, string>>
}

function looksBinary(body: string): boolean {
  return body.includes('\u0000')
}

/** Source before tests, then smallest first; path breaks ties so the order is stable. */
function contextOrder(a: ContextFile, b: ContextFile): number {
  return (
    Number(isTestPath(a.path)) - Number(isTestPath(b.path)) ||
    a.body.length - b.body.length ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  )
}

/**
 * PURE — pack whole files under `maxChars`. A file that does not fit is
 * skipped and the next (larger, or a test) is still tried — the same
 * skip-and-continue `packSecurityDiff` uses, so one big file never starves
 * every file behind it.
 */
export function packReviewContext(
  files: readonly ContextFile[],
  maxChars: number = REVIEW_CONTEXT_MAX_CHARS
): PackedReviewContext {
  const eligible = files
    .filter(
      f =>
        !isSkippedContextPath(f.path) &&
        f.body.length <= REVIEW_CONTEXT_MAX_FILE_CHARS &&
        f.body.trim().length > 0 &&
        !looksBinary(f.body)
    )
    .sort(contextOrder)
  let text = ''
  const included: string[] = []
  const bodies: Record<string, string> = {}
  for (const f of eligible) {
    const block = `=== ${f.path} ===\n${f.body}\n`
    if (text.length + block.length > maxChars) continue
    text += block
    included.push(f.path)
    bodies[f.path] = f.body
  }
  return { text, included, bodies }
}

/**
 * PURE — LUM-1150: one packed file's content, as read at the PR head, or null
 * when it was not packed (or the context predates `bodies`).
 */
export function packedFileBody(
  packed: PackedReviewContext,
  path: string
): string | null {
  const bodies = packed.bodies
  // Own keys only: a path named `constructor` must not read Object's member.
  if (!bodies || !Object.prototype.hasOwnProperty.call(bodies, path))
    return null
  return bodies[path] ?? null
}

export interface LoadedReviewContext extends PackedReviewContext {
  /** Why there is no context, when a read failed or timed out; null otherwise. */
  error: string | null
}

const NO_CONTEXT = (error: string | null): LoadedReviewContext => ({
  text: '',
  included: [],
  error,
})

/**
 * Read the changed files at PR head and pack them. `readFile` returns null for
 * a file that does not exist at that ref (skipped); a throw — a repository
 * that is not confirmed (403), a rate limit, a network error — or running
 * past `timeoutMs` drops ALL context: a partial set chosen by which reads
 * happened to succeed is not the set the packing rules picked.
 */
export async function loadReviewContext(opts: {
  /** Changed, not-deleted paths the review covers. */
  paths: readonly string[]
  /**
   * `signal` aborts when the budget runs out, so in-flight reads stop instead
   * of finishing against a token the caller revokes right after.
   */
  readFile: (path: string, signal: AbortSignal) => Promise<string | null>
  maxChars?: number
  timeoutMs?: number
}): Promise<LoadedReviewContext> {
  const candidates = [...new Set(opts.paths)]
    .filter(p => !isSkippedContextPath(p))
    .sort((a, b) => Number(isTestPath(a)) - Number(isTestPath(b)))
    .slice(0, REVIEW_CONTEXT_MAX_READS)
  if (candidates.length === 0) return NO_CONTEXT(null)

  const files: ContextFile[] = []
  const queue = [...candidates]
  const abort = new AbortController()
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      const body = await opts.readFile(path, abort.signal)
      if (body !== null) files.push({ path, body })
    }
  }
  const reads = Promise.all(
    Array.from(
      { length: Math.min(REVIEW_CONTEXT_READ_CONCURRENCY, candidates.length) },
      worker
    )
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<'timeout'>(resolve => {
    timer = setTimeout(
      () => resolve('timeout'),
      opts.timeoutMs ?? REVIEW_CONTEXT_TIMEOUT_MS
    )
  })
  try {
    const outcome = await Promise.race([
      reads.then(() => 'done' as const),
      timeout,
    ])
    if (outcome === 'timeout') {
      // Stop handing out new reads and abort the in-flight ones.
      queue.length = 0
      abort.abort()
      return NO_CONTEXT('timed out reading changed files')
    }
  } catch (error) {
    queue.length = 0
    abort.abort()
    return NO_CONTEXT(error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
  }
  return { ...packReviewContext(files, opts.maxChars), error: null }
}
