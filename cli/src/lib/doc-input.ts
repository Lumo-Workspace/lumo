import * as fs from 'fs'

export interface ResolveDocContentArgs {
  content: string | undefined
  file: string | undefined
  stdinIsTTY: boolean
  readStdin: () => Promise<string>
  readFile: (path: string) => Promise<string>
}

export type ResolveDocContentResult =
  | { kind: 'ok'; markdown: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

/**
 * Pick one of --content / --file / stdin as the markdown source.
 * The three are mutually exclusive; specifying more than one is an error.
 * If none of them are set and stdin is a TTY, returns 'none'.
 */
export async function resolveDocContent(
  args: ResolveDocContentArgs
): Promise<ResolveDocContentResult> {
  const hasContent = args.content !== undefined
  const hasFile = args.file !== undefined && args.file.length > 0
  const hasStdin = !args.stdinIsTTY

  const set = [hasContent, hasFile, hasStdin].filter(Boolean).length
  if (set > 1) {
    return {
      kind: 'error',
      message:
        '--content, --file, and stdin are mutually exclusive (pick one)',
    }
  }

  if (hasContent) return { kind: 'ok', markdown: args.content as string }
  if (hasFile) {
    const text = await args.readFile(args.file as string)
    return { kind: 'ok', markdown: text }
  }
  if (hasStdin) {
    const text = await args.readStdin()
    return { kind: 'ok', markdown: text }
  }
  return { kind: 'none' }
}

/** Read stdin to end as UTF-8 string. */
export function readStdinToString(): Promise<string> {
  return new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (buf += chunk))
    process.stdin.on('end', () => resolve(buf))
  })
}

/** Default readFile wrapper for production CLI use. */
export function readFileUtf8(path: string): Promise<string> {
  return fs.promises.readFile(path, 'utf8')
}
