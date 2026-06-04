import { createDebouncedSerializer } from '@/lib/editor/debounced-serializer'

describe('createDebouncedSerializer', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
  })

  describe('eager mode (delayMs <= 0)', () => {
    it('serializes and emits synchronously on every schedule()', () => {
      let n = 0
      const serialize = jest.fn(() => `v${n}`)
      const emit = jest.fn()
      const s = createDebouncedSerializer(serialize, emit, 0)

      n = 1
      s.schedule()
      n = 2
      s.schedule()

      expect(serialize).toHaveBeenCalledTimes(2)
      expect(emit).toHaveBeenNthCalledWith(1, 'v1')
      expect(emit).toHaveBeenNthCalledWith(2, 'v2')
    })

    it('treats a negative delay as eager', () => {
      const emit = jest.fn()
      const s = createDebouncedSerializer(() => 'x', emit, -100)
      s.schedule()
      expect(emit).toHaveBeenCalledWith('x')
    })
  })

  describe('debounce mode (delayMs > 0)', () => {
    it('does NOT serialize on schedule() — only lazily when the timer fires', () => {
      const serialize = jest.fn(() => 'html')
      const emit = jest.fn()
      const s = createDebouncedSerializer(serialize, emit, 300)

      s.schedule()
      s.schedule()
      s.schedule()

      // The whole point of the perf fix: getHTML() must not run per keystroke.
      expect(serialize).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()

      jest.advanceTimersByTime(300)

      expect(serialize).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledWith('html')
    })

    it('emits the latest value at fire time (trailing edge)', () => {
      let current = 'a'
      const s = createDebouncedSerializer(
        () => current,
        v => {
          // capture
          emitted.push(v)
        },
        300
      )
      const emitted: (string | null)[] = []

      current = 'a'
      s.schedule()
      current = 'ab'
      s.schedule()
      current = 'abc'
      s.schedule()

      jest.advanceTimersByTime(300)
      expect(emitted).toEqual(['abc'])
    })

    it('resets the timer on each schedule() so it fires delayMs after the LAST one', () => {
      const emit = jest.fn()
      const s = createDebouncedSerializer(() => 'x', emit, 300)

      s.schedule()
      jest.advanceTimersByTime(200)
      s.schedule() // reset
      jest.advanceTimersByTime(200) // 400ms since first, 200ms since last
      expect(emit).not.toHaveBeenCalled()

      jest.advanceTimersByTime(100) // now 300ms since last
      expect(emit).toHaveBeenCalledTimes(1)
    })

    it('emits null when serialize returns null', () => {
      const emit = jest.fn()
      const s = createDebouncedSerializer(() => null, emit, 300)
      s.schedule()
      jest.advanceTimersByTime(300)
      expect(emit).toHaveBeenCalledWith(null)
    })
  })

  describe('flush()', () => {
    it('emits the pending value synchronously and cancels the timer', () => {
      const serialize = jest.fn(() => 'final')
      const emit = jest.fn()
      const s = createDebouncedSerializer(serialize, emit, 300)

      s.schedule()
      s.flush()

      expect(emit).toHaveBeenCalledTimes(1)
      expect(emit).toHaveBeenCalledWith('final')

      // No second emit when timers advance — the pending timer was cancelled.
      jest.advanceTimersByTime(300)
      expect(emit).toHaveBeenCalledTimes(1)
    })

    it('is a no-op when nothing is pending', () => {
      const serialize = jest.fn(() => 'x')
      const emit = jest.fn()
      const s = createDebouncedSerializer(serialize, emit, 300)

      s.flush()
      expect(serialize).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('does not re-emit on a second flush()', () => {
      const emit = jest.fn()
      const s = createDebouncedSerializer(() => 'x', emit, 300)
      s.schedule()
      s.flush()
      s.flush()
      expect(emit).toHaveBeenCalledTimes(1)
    })
  })

  describe('cancel()', () => {
    it('drops the pending value without emitting', () => {
      const serialize = jest.fn(() => 'x')
      const emit = jest.fn()
      const s = createDebouncedSerializer(serialize, emit, 300)

      s.schedule()
      s.cancel()
      jest.advanceTimersByTime(300)

      expect(serialize).not.toHaveBeenCalled()
      expect(emit).not.toHaveBeenCalled()
    })

    it('makes a subsequent flush() a no-op', () => {
      const emit = jest.fn()
      const s = createDebouncedSerializer(() => 'x', emit, 300)
      s.schedule()
      s.cancel()
      s.flush()
      expect(emit).not.toHaveBeenCalled()
    })
  })
})
