import { useEffect, useRef, type RefObject } from 'react'

/**
 * Auto-hiding scrollbar (macOS overlay style): the scroll container reveals its
 * scrollbar thumb only while it is actively scrolling, then fades it after
 * `hideDelayMs` of inactivity.
 *
 * The hook toggles the `scrollbar-visible` class that the CSS in `globals.css`
 * keys off. The scrollbar track keeps a constant width there (only the thumb
 * colour transitions), so showing/hiding causes no layout shift.
 *
 * @param hideDelayMs idle time before the scrollbar fades again. Default 1000ms.
 * @returns a ref to attach to the scrollable element.
 */
export function useAutoHideScrollbar<T extends HTMLElement>(
  hideDelayMs = 1000
): RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    let timer: ReturnType<typeof setTimeout> | null = null
    const onScroll = () => {
      el.classList.add('scrollbar-visible')
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        el.classList.remove('scrollbar-visible')
        timer = null
      }, hideDelayMs)
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
    }
  }, [hideDelayMs])

  return ref
}
