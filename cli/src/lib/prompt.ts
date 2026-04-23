/**
 * Prompt the user for a secret with echo disabled.
 *
 * Returns the trimmed input. Exits the process with code 130 on Ctrl+C.
 * Falls back to a regular line-read when stdin is not a TTY (piped input).
 */
export function promptSecret(message: string): Promise<string> {
  return new Promise(resolve => {
    const stdin = process.stdin
    const stdout = process.stdout

    if (!stdin.isTTY) {
      let buf = ''
      stdin.setEncoding('utf8')
      const onData = (chunk: string) => {
        buf += chunk
        const nl = buf.indexOf('\n')
        if (nl !== -1) {
          stdin.pause()
          stdin.removeListener('data', onData)
          resolve(buf.slice(0, nl).trim())
        }
      }
      stdin.on('data', onData)
      stdin.on('end', () => resolve(buf.trim()))
      return
    }

    stdout.write(message)
    const wasRaw = stdin.isRaw
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let buf = ''
    const cleanup = () => {
      stdin.setRawMode(wasRaw)
      stdin.removeListener('data', onData)
      stdin.pause()
      stdout.write('\n')
    }

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003') {
          // Ctrl+C — treat as cancel, exit cleanly
          cleanup()
          resolve('')
          process.exit(130)
        }
        if (ch === '\u0004') {
          cleanup()
          resolve(buf.trim())
          return
        }
        if (ch === '\r' || ch === '\n') {
          cleanup()
          resolve(buf.trim())
          return
        }
        if (ch === '\u0008' || ch === '\u007f') {
          buf = buf.slice(0, -1)
          continue
        }
        if (ch.charCodeAt(0) < 0x20) continue
        buf += ch
      }
    }
    stdin.on('data', onData)
  })
}
