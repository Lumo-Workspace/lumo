/** How long a yes/no prompt waits for an answer before counting as "no". */
export const ANSWER_TIMEOUT_MS = 60_000

/** The slice of a readable stream the prompt uses (process.stdin or a test double). */

type Listener = (...args: any[]) => void

export interface AnswerStream {
  on(event: string, fn: Listener): unknown
  removeListener(event: string, fn: Listener): unknown
  resume(): unknown
  pause?(): unknown
  setEncoding?(enc: string): unknown
}

/**
 * Print `question`, read ONE line from stdin and return whether it is
 * `y` / `yes` (case-insensitive, trimmed). Anything else — another answer, an
 * empty line, EOF / closed stdin, or no answer within `timeoutMs` — is "no".
 * Never hangs: the timer fires even when stdin stays open and silent. Works
 * with or without a TTY (a piped `y` is accepted).
 */
export function askYesNo(
  question: string,
  opts: {
    stdin?: AnswerStream
    write?: (s: string) => void
    timeoutMs?: number
  } = {}
): Promise<boolean> {
  const stdin = opts.stdin ?? process.stdin
  const write = opts.write ?? ((s: string) => process.stdout.write(s))
  const timeoutMs = opts.timeoutMs ?? ANSWER_TIMEOUT_MS
  return new Promise(resolve => {
    write(question)
    let buf = ''
    let done = false
    const finish = (answer: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      stdin.removeListener('error', onEnd)
      stdin.pause?.()
      write('\n')
      resolve(/^(y|yes)$/i.test(answer.trim()))
    }
    const onData = (chunk: string | Buffer): void => {
      buf += chunk.toString()
      const nl = buf.indexOf('\n')
      if (nl !== -1) finish(buf.slice(0, nl).replace(/\r$/, ''))
    }
    const onEnd = (): void => finish('')
    const timer = setTimeout(() => finish(''), timeoutMs)
    stdin.setEncoding?.('utf8')
    stdin.on('data', onData)
    stdin.on('end', onEnd)
    stdin.on('error', onEnd)
    stdin.resume()
  })
}
