/**
 * LUM-1021 — local-disk backend for single-node self-hosting.
 *
 * Layout under `LOCAL_BLOB_DIR` (created 0700, files 0600):
 *
 *   public/<pathname>             public objects (workspace logos)
 *   private/<pathname>            private objects
 *   .meta/<access>/<pathname>.json  content type + upload time
 *   .tmp/                         in-flight writes (atomic rename / link)
 *
 * Nothing here is ever served as a static path: the directory must live
 * outside Next's `public/`, private objects are only streamed by an
 * authorising route (`/api/files/...`, the export download), and the public
 * route `/api/blob/public/...` can only reach `public/`.
 */
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import {
  assertSafePathname,
  assertSafePrefix,
  blobError,
  blobRef,
  bodyToBuffer,
  inferContentType,
  pathnameFromRef,
  withRandomSuffix,
  type BlobAccess,
  type BlobStorage,
  type ListBlobsPage,
  type ListedBlob,
} from '@/lib/blob/types'

interface Meta {
  contentType: string
  uploadedAt: string
}

function isCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code
}

/**
 * The resolved blob root, refusing a directory a static file server would
 * expose (Next serves `<cwd>/public` verbatim).
 */
export function resolveDiskRoot(
  dir: string,
  cwd: string = process.cwd()
): string {
  const root = resolve(cwd, dir)
  const staticDir = resolve(cwd, 'public')
  const rel = relative(staticDir, root)
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
    throw new Error(
      `LOCAL_BLOB_DIR (${root}) is inside Next's public/ folder — private files would be served without auth`
    )
  }
  return root
}

export function createDiskBlobStorage(dir: string): BlobStorage {
  const root = resolveDiskRoot(dir)
  const nsDir = (access: BlobAccess) => join(root, access)

  /** Absolute path of an object, re-checked to stay inside its namespace. */
  function fileOf(access: BlobAccess, pathname: string): string {
    assertSafePathname(pathname)
    const base = nsDir(access)
    const p = resolve(base, pathname)
    if (!p.startsWith(base + sep)) {
      throw blobError(`blob pathname escapes its namespace: ${pathname}`, 400)
    }
    return p
  }
  const metaOf = (access: BlobAccess, pathname: string) =>
    resolve(root, '.meta', access, `${pathname}.json`)

  async function writeAtomic(
    target: string,
    bytes: Buffer,
    overwrite: boolean
  ): Promise<void> {
    await mkdir(join(root, '.tmp'), { recursive: true, mode: 0o700 })
    await mkdir(dirname(target), { recursive: true, mode: 0o700 })
    const tmp = join(root, '.tmp', randomUUID())
    await writeFile(tmp, bytes, { mode: 0o600 })
    try {
      if (overwrite) {
        await rename(tmp, target)
        return
      }
      // link() fails with EEXIST instead of replacing — an atomic
      // "create only if absent".
      await link(tmp, target)
    } catch (error) {
      if (isCode(error, 'EEXIST')) {
        throw blobError(`blob already exists: ${relative(root, target)}`, 409)
      }
      throw error
    } finally {
      await unlink(tmp).catch(() => undefined)
    }
  }

  async function readMeta(
    access: BlobAccess,
    pathname: string
  ): Promise<Meta | null> {
    try {
      return JSON.parse(
        await readFile(metaOf(access, pathname), 'utf8')
      ) as Meta
    } catch {
      return null
    }
  }

  /** Remove now-empty parent directories up to (not including) `stop`. */
  async function pruneEmptyDirs(from: string, stop: string): Promise<void> {
    let d = dirname(from)
    while (d.startsWith(stop + sep)) {
      try {
        await rmdir(d)
      } catch {
        return
      }
      d = dirname(d)
    }
  }

  async function walk(dirPath: string, out: string[]): Promise<void> {
    let entries
    try {
      entries = await readdir(dirPath, { withFileTypes: true })
    } catch (error) {
      if (isCode(error, 'ENOENT') || isCode(error, 'ENOTDIR')) return
      throw error
    }
    for (const e of entries) {
      const p = join(dirPath, e.name)
      if (e.isDirectory()) await walk(p, out)
      else if (e.isFile()) out.push(p)
    }
  }

  return {
    kind: 'disk',

    async put(pathname, body, opts) {
      assertSafePathname(pathname)
      const finalPath = opts.addRandomSuffix
        ? withRandomSuffix(pathname)
        : pathname
      const target = fileOf(opts.access, finalPath)
      const bytes = await bodyToBuffer(body)
      await writeAtomic(target, bytes, Boolean(opts.allowOverwrite))
      const meta: Meta = {
        contentType: inferContentType(body, opts.contentType),
        uploadedAt: new Date().toISOString(),
      }
      await writeAtomic(
        metaOf(opts.access, finalPath),
        Buffer.from(JSON.stringify(meta)),
        true
      )
      return { url: blobRef(opts.access, finalPath), pathname: finalPath }
    },

    async get(urlOrPathname, access) {
      const pathname = pathnameFromRef(urlOrPathname, access)
      const file = fileOf(access, pathname)
      let size: number
      try {
        const st = await stat(file)
        if (!st.isFile()) return null
        size = st.size
      } catch (error) {
        if (isCode(error, 'ENOENT') || isCode(error, 'ENOTDIR')) return null
        throw error
      }
      const meta = await readMeta(access, pathname)
      return {
        stream: Readable.toWeb(
          createReadStream(file)
        ) as ReadableStream<Uint8Array>,
        contentType: meta?.contentType ?? 'application/octet-stream',
        size,
      }
    },

    async delete(urlsOrPathnames, access) {
      const refs = Array.isArray(urlsOrPathnames)
        ? urlsOrPathnames
        : [urlsOrPathnames]
      for (const ref of refs) {
        const pathname = pathnameFromRef(ref, access)
        const file = fileOf(access, pathname)
        for (const p of [file, metaOf(access, pathname)]) {
          try {
            await unlink(p)
          } catch (error) {
            if (!isCode(error, 'ENOENT')) throw error
          }
        }
        await pruneEmptyDirs(file, nsDir(access))
      }
    },

    async list({ access, prefix, limit, cursor }): Promise<ListBlobsPage> {
      assertSafePrefix(prefix)
      const base = nsDir(access)
      // Only walk the deepest directory the prefix pins down.
      const slash = prefix.lastIndexOf('/')
      const start = slash >= 0 ? join(base, prefix.slice(0, slash)) : base
      const files: string[] = []
      await walk(start, files)
      const pathnames = files
        .map(f => relative(base, f).split(sep).join('/'))
        .filter(p => p.startsWith(prefix))
        .filter(p => (cursor ? p > cursor : true))
        .sort()
      const max = Math.max(1, Math.min(limit ?? 1000, 1000))
      const pageNames = pathnames.slice(0, max)
      const blobs: ListedBlob[] = []
      for (const pathname of pageNames) {
        const meta = await readMeta(access, pathname)
        blobs.push({
          url: blobRef(access, pathname),
          pathname,
          uploadedAt: meta ? new Date(meta.uploadedAt) : new Date(0),
        })
      }
      const hasMore = pathnames.length > max
      return {
        blobs,
        hasMore,
        ...(hasMore ? { cursor: pageNames[pageNames.length - 1] } : {}),
      }
    },

    async signedReadUrl() {
      throw blobError(
        'signed read URLs are not supported on local-disk storage — private files are streamed by an authorising route',
        501
      )
    },
  }
}
