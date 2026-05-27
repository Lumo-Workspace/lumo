// Plain-text line prompt for interactive choices. Echoes input (unlike
// promptSecret). Returns the trimmed line. Resolves with an empty string when
// stdin ends before a newline (callers should fall back to a default).
export function promptLine(message: string): Promise<string> {
  return new Promise(resolve => {
    const stdin = process.stdin

    if (stdin.isTTY) {
      process.stdout.write(message)
    }

    stdin.resume()
    stdin.setEncoding('utf8')

    let buf = ''
    const onData = (chunk: string) => {
      buf += chunk
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      cleanup()
      resolve(buf.slice(0, nl).replace(/\r$/, '').trim())
    }
    const onEnd = () => {
      cleanup()
      resolve(buf.trim())
    }
    const cleanup = () => {
      stdin.removeListener('data', onData)
      stdin.removeListener('end', onEnd)
      stdin.pause()
    }
    stdin.on('data', onData)
    stdin.on('end', onEnd)
  })
}
