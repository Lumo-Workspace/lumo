/**
 * LUM-1233: where a renderer writes its stdout. Commands default to
 * `process.stdout`; `task show` passes a buffer so one call can stack several
 * aspects (and fold their `--json` into one envelope).
 */
export interface OutputSink {
  write(s: string): unknown
}

/** A sink that keeps everything written to it. */
export function bufferSink(): OutputSink & { text(): string } {
  const parts: string[] = []
  return {
    write(s: string) {
      parts.push(s)
      return true
    },
    text: () => parts.join(''),
  }
}
