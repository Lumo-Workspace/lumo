import type { ReactNode, Ref } from 'react'

import styles from './home.module.css'

/**
 * The window chrome shared by the homepage hero mock card and the demo terminal:
 * a rounded card with a title bar (three traffic-light dots + a label) over a
 * body slot. The two looks are picked by `variant` — kept pixel-for-pixel with
 * the originals — while the structure lives here once.
 *
 * The terminal's Monet-sunrise wallpaper is NOT part of the shell: it stays a
 * terminal-only wrapper around this component, so the hero card renders flat.
 */
export interface WindowShellProps {
  /** `mock` = hero card (flat, cream dots); `terminal` = macOS hover dots. */
  variant: 'mock' | 'terminal'
  /** Title-bar content shown after the dots (e.g. a mark + path label). */
  label: ReactNode
  /** Body content. */
  children: ReactNode
  /** Class controlling body padding/typography — caller owns its body look. */
  bodyClassName?: string | undefined
  /** Forwarded to the card element (the terminal observes it for scroll-in). */
  cardRef?: Ref<HTMLDivElement> | undefined
  /** Accessible label for the body region. */
  bodyAriaLabel?: string | undefined
}

export function WindowShell({
  variant,
  label,
  children,
  bodyClassName,
  cardRef,
  bodyAriaLabel,
}: WindowShellProps) {
  const variantClass =
    variant === 'terminal' ? styles.shellTerminal : styles.shellMock

  return (
    <div className={`${styles.shell} ${variantClass}`} ref={cardRef}>
      <div className={styles.shellBar}>
        <span className={styles.dot} />
        <span className={styles.dot} />
        <span className={styles.dot} />
        {label}
      </div>
      <div className={bodyClassName} aria-label={bodyAriaLabel}>
        {children}
      </div>
    </div>
  )
}
