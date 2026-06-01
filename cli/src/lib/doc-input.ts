import * as fs from 'fs'
import { checkArtifactFilePath, type PathGuardResult } from './path-guard'

export interface ResolveDocContentArgs {
  content: string | undefined
  file: string | undefined
  stdinIsTTY: boolean
  readStdin: () => Promise<string>
  readFile: (path: string) => Promise<string>
  /**
   * Path-safety guard for the --file branch. Defaults to checkArtifactFilePath,
   * which confines the path to the project directory and rejects sensitive
   * files. Injectable so tests don't touch the real filesystem.
   */
  checkFilePath?: (p: string) => PathGuardResult
}

export type ResolveDocContentResult =
  | { kind: 'ok'; markdown: string }
  | { kind: 'none' }
  | { kind: 'error'; message: string }

/**
 * Pick one of --content / --file / stdin as the markdown source.
 * Explicit flags win: if --content or --file is set, stdin is ignored
 * (whether the shell is interactive or not). --content and --file are
 * mutually exclusive. stdin is only consulted when neither flag is set
 * and the shell is non-TTY.
 */
export async function resolveDocContent(
  args: ResolveDocContentArgs
): Promise<ResolveDocContentResult> {
  const hasContent = args.content !== undefined
  const hasFile = args.file !== undefined && args.file.length > 0

  if (hasContent && hasFile) {
    return {
      kind: 'error',
      message: '--content and --file are mutually exclusive (pick one)',
    }
  }

  if (hasContent) return { kind: 'ok', markdown: args.content as string }
  if (hasFile) {
    const check = (args.checkFilePath ?? checkArtifactFilePath)(
      args.file as string
    )
    if (!check.ok) {
      return {
        kind: 'error',
        message:
          check.reason === 'unreadable'
            ? `could not read file ${args.file}`
            : `refusing to read ${args.file} — ${check.detail}. ` +
              `--file must be a non-sensitive path inside the project directory.`,
      }
    }
    const text = await args.readFile(check.resolved)
    return { kind: 'ok', markdown: text }
  }
  if (!args.stdinIsTTY) {
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
