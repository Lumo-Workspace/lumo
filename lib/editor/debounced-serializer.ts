/**
 * Coalesces an editor's expensive full-document serialization (e.g.
 * `editor.getHTML()`) so it runs at most once per quiet window instead of on
 * every keystroke.
 *
 * `serialize` is called *lazily* — only when a pending change actually flushes —
 * so the heavy work never runs on the hot keystroke path. With `delayMs <= 0`
 * the serializer is eager: it serializes and emits synchronously on every
 * `schedule()`, preserving the original per-update contract for callers that
 * opt out of debouncing.
 */
export interface DebouncedSerializer {
  /** Register an editor update. Eager when `delayMs <= 0`, else (re)arms a trailing-edge timer. */
  schedule(): void
  /** Emit any pending value now and cancel the timer. No-op when nothing is pending. */
  flush(): void
  /** Drop any pending value without emitting. */
  cancel(): void
}

export function createDebouncedSerializer(
  serialize: () => string | null,
  emit: (value: string | null) => void,
  delayMs: number
): DebouncedSerializer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending = false

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const fire = () => {
    timer = null
    if (!pending) return
    pending = false
    emit(serialize())
  }

  return {
    schedule() {
      if (delayMs <= 0) {
        emit(serialize())
        return
      }
      pending = true
      clear()
      timer = setTimeout(fire, delayMs)
    },
    flush() {
      clear()
      if (!pending) return
      pending = false
      emit(serialize())
    },
    cancel() {
      clear()
      pending = false
    },
  }
}
