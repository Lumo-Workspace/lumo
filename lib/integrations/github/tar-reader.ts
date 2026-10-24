/**
 * LUM-1310 — an incremental reader for the (already gunzipped) tar stream
 * of a GitHub repository archive (`/repos/{o}/{r}/tarball/{ref}`): feed it
 * chunks, it hands back each regular file it was asked for.
 *
 * PURE (no I/O): `contents.ts` does the request and the gunzip. Enough of
 * the format for git archives — ustar name + prefix, pax `path` records
 * (`x`), GNU long names (`L`); the pax global header (`g`, the commit id),
 * directories, links and everything else are skipped. GitHub prefixes every
 * path with one `<owner>-<repo>-<sha>/` directory, which is stripped.
 *
 * Bounded: a file over `maxFileBytes`, or one `wantPath` declines, is
 * skipped without being buffered. No new dependency (CLAUDE.md).
 */

const BLOCK = 512
/** A pax / long-name header body larger than this is malformed — skipped. */
const META_MAX = 64 * 1024

export interface TarReaderOptions {
  /** Repo-relative path (archive directory stripped) — read this file? */
  wantPath: (path: string) => boolean
  maxFileBytes: number
  onFile: (path: string, content: Buffer) => void
  /** A wanted regular file skipped unread for being over `maxFileBytes`. */
  onSkip?: (path: string, size: number) => void
}

function cstr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len)
  const end = slice.indexOf(0)
  return slice.subarray(0, end < 0 ? slice.length : end).toString('utf8')
}

/** Octal, or GNU base-256 when the first byte's high bit is set. */
function size(buf: Buffer): number {
  const field = buf.subarray(124, 136)
  if ((field[0]! & 0x80) !== 0) {
    let n = 0
    for (let i = 1; i < field.length; i++) n = n * 256 + field[i]!
    return n
  }
  const text = cstr(buf, 124, 12).trim()
  return text ? parseInt(text, 8) : 0
}

/** The `path` record of a pax extended header, if any. */
function paxPath(body: Buffer): string | null {
  let path: string | null = null
  let at = 0
  while (at < body.length) {
    const space = body.indexOf(0x20, at)
    if (space < 0) break
    const len = parseInt(body.subarray(at, space).toString('utf8'), 10)
    if (!Number.isFinite(len) || len <= 0) break
    const record = body.subarray(space + 1, at + len - 1).toString('utf8')
    const eq = record.indexOf('=')
    if (eq > 0 && record.slice(0, eq) === 'path') path = record.slice(eq + 1)
    at += len
  }
  return path
}

/** Drop the archive's top directory; null for the directory itself. */
function repoPath(archivePath: string): string | null {
  const slash = archivePath.indexOf('/')
  if (slash < 0) return null
  const rest = archivePath.slice(slash + 1)
  return rest.length > 0 ? rest : null
}

type Body =
  | { kind: 'file'; path: string; parts: Buffer[] }
  | { kind: 'pax' | 'longname'; parts: Buffer[] }
  | { kind: 'skip' }

export class TarReader {
  private pending: Buffer = Buffer.alloc(0)
  /** Bytes of the current entry's body still to come (padding included). */
  private remaining = 0
  /** The body's real length (without the padding). */
  private bodyLength = 0
  private bodyRead = 0
  private body: Body | null = null
  /** A path set by a preceding pax / long-name header. */
  private nextPath: string | null = null
  private ended = false

  constructor(private readonly opts: TarReaderOptions) {}

  /** True once the end-of-archive block was read. */
  get done(): boolean {
    return this.ended
  }

  push(chunk: Buffer): void {
    let buf =
      this.pending.length > 0 ? Buffer.concat([this.pending, chunk]) : chunk
    while (!this.ended) {
      if (this.body) {
        if (buf.length === 0) break
        const take = Math.min(this.remaining, buf.length)
        const real = Math.max(
          0,
          Math.min(take, this.bodyLength - this.bodyRead)
        )
        if (this.body.kind !== 'skip' && real > 0)
          this.body.parts.push(buf.subarray(0, real))
        this.bodyRead += take
        this.remaining -= take
        buf = buf.subarray(take)
        if (this.remaining === 0) this.finishBody()
        continue
      }
      if (buf.length < BLOCK) break
      const header = buf.subarray(0, BLOCK)
      buf = buf.subarray(BLOCK)
      this.startEntry(header)
    }
    this.pending = Buffer.from(buf)
  }

  private startEntry(header: Buffer): void {
    if (header.every(b => b === 0)) {
      this.ended = true
      return
    }
    const length = size(header)
    const type = String.fromCharCode(header[156]!)
    const name = cstr(header, 0, 100)
    const prefix =
      header.subarray(257, 262).toString('utf8') === 'ustar'
        ? cstr(header, 345, 155)
        : ''
    const fullName = this.nextPath ?? (prefix ? `${prefix}/${name}` : name)
    let body: Body = { kind: 'skip' }
    if (type === 'x' && length <= META_MAX) body = { kind: 'pax', parts: [] }
    else if (type === 'L' && length <= META_MAX)
      body = { kind: 'longname', parts: [] }
    else if (type === 'g' || type === 'x' || type === 'L')
      body = { kind: 'skip' }
    else {
      // Any other header consumes the pending path.
      this.nextPath = null
      if (type === '0' || type === '\0') {
        const path = repoPath(fullName)
        if (path !== null && this.opts.wantPath(path)) {
          if (length <= this.opts.maxFileBytes)
            body = { kind: 'file', path, parts: [] }
          else this.opts.onSkip?.(path, length)
        }
      }
    }
    this.body = body
    this.bodyLength = length
    this.bodyRead = 0
    this.remaining = Math.ceil(length / BLOCK) * BLOCK
    if (this.remaining === 0) this.finishBody()
  }

  private finishBody(): void {
    const body = this.body
    this.body = null
    if (!body || body.kind === 'skip') return
    const content = Buffer.concat(body.parts)
    if (body.kind === 'file') this.opts.onFile(body.path, content)
    else if (body.kind === 'pax')
      this.nextPath = paxPath(content) ?? this.nextPath
    else this.nextPath = cstr(content, 0, content.length)
  }
}
