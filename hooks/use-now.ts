import { useEffect, useState } from 'react'

/**
 * Current wall-clock time (ms epoch) held in state, refreshed every
 * `intervalMs`. Returns `null` until the component has mounted so the server
 * render and the first client render agree (no hydration mismatch / no
 * relative-time flicker). Callers render a stable fallback while it is `null`.
 *
 * Reading the clock during render violates React purity (see CLAUDE.md), so
 * `Date.now()` lives only inside the mount effect and the interval — render
 * stays a pure read of state. Relative-time labels also auto-refresh as the
 * interval ticks.
 */
export function useNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
