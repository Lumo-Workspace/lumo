/**
 * LUM-858 — the only place that touches `fflate`. A streaming zip writer:
 * each file is deflated as it is added, so the caller can feed rows page by
 * page (NDJSON) instead of holding the whole workspace as one string.
 */
import { Zip, ZipDeflate, strToU8 } from 'fflate'

export interface ZipWriter {
  /** Add one text file (UTF-8). Paths use `/` and must be unique. */
  addText(path: string, text: string): void
  /** Open a file that is written in several chunks (e.g. NDJSON pages). */
  openText(path: string): { write(text: string): void; close(): void }
  /** Finish the archive and return its bytes. */
  finish(): Promise<Uint8Array>
}

export function createZipWriter(): ZipWriter {
  const chunks: Uint8Array[] = []
  let failure: Error | null = null
  let resolveDone: () => void = () => undefined
  const done = new Promise<void>(resolve => {
    resolveDone = resolve
  })
  const zip = new Zip((err, data, final) => {
    if (err) {
      failure = err
      resolveDone()
      return
    }
    chunks.push(data)
    if (final) resolveDone()
  })

  function openText(path: string) {
    const file = new ZipDeflate(path, { level: 6 })
    zip.add(file)
    return {
      write: (text: string) => file.push(strToU8(text)),
      close: () => file.push(new Uint8Array(0), true),
    }
  }

  return {
    addText(path, text) {
      const file = openText(path)
      file.write(text)
      file.close()
    },
    openText,
    async finish() {
      zip.end()
      await done
      if (failure) throw failure
      const size = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(size)
      let offset = 0
      for (const c of chunks) {
        out.set(c, offset)
        offset += c.length
      }
      return out
    },
  }
}

/** Test/inspection helper: file path → UTF-8 text for a zip's bytes. */
export async function readZipText(
  bytes: Uint8Array
): Promise<Record<string, string>> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const files = unzipSync(bytes)
  return Object.fromEntries(
    Object.entries(files).map(([path, data]) => [path, strFromU8(data)])
  )
}
