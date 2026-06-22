'use client'

import { useEffect, useState } from 'react'

import styles from './home.module.css'

type LineKind = 'user' | 'agent' | 'cmd' | 'out' | 'comment' | 'pass' | 'ok'

interface Line {
  kind: LineKind
  text: string
}

// A real Claude Code session driving Lumo: you ask in plain language, the agent
// CREATES the task and runs the workflow (attach → context → criteria → verify)
// via the `lumo` CLI. These are the actual commands the lumo skill prescribes
// and the real shapes they print — no invented commands.
const SCRIPT: Line[] = [
  {
    kind: 'user',
    text: 'Add a Stripe checkout flow — create the task and start on it.',
  },
  {
    kind: 'agent',
    text: 'On it. Filing the task and attaching this session.',
  },
  {
    kind: 'cmd',
    text: 'lumo task create "Add Stripe checkout flow" --priority high',
  },
  { kind: 'out', text: 'Created LUM-204 — uselumo.ai/…/my-tasks/LUM-204' },
  { kind: 'cmd', text: 'lumo session attach LUM-204' },
  { kind: 'out', text: 'Attached session to LUM-204' },
  { kind: 'cmd', text: 'lumo task context LUM-204' },
  {
    kind: 'out',
    text: '▸ 3 prior sessions · 2 source cards · 1 open PR-review todo',
  },
  {
    kind: 'agent',
    text: 'No acceptance criteria yet — I’ll draft the contract before coding.',
  },
  { kind: 'cmd', text: 'lumo task criteria set LUM-204 --file criteria.json' },
  { kind: 'out', text: 'Acceptance contract drafted (6 criteria)' },
  { kind: 'comment', text: '# … writes the code, opens a PR …' },
  { kind: 'cmd', text: 'lumo verify LUM-204' },
  { kind: 'out', text: 'Verifying LUM-204 — 3 MACHINE criteria' },
  { kind: 'pass', text: '[1/3] Card payment succeeds end-to-end       ✓ PASS' },
  {
    kind: 'pass',
    text: '[2/3] Declined cards show a clear error       ✓ PASS',
  },
  { kind: 'pass', text: '[3/3] Receipts emailed within 30s            ✓ PASS' },
  { kind: 'ok', text: '✓ All criteria passed — task is now IN_REVIEW' },
]

const TYPE_MS = 28 // per character while typing a user prompt or command
const TYPED_HOLD_MS = 420 // pause after a typed line finishes
const OUT_MS = 150 // delay before the next output/narration line
const LOOP_HOLD_MS = 3000 // pause on the final frame before looping

// The two line kinds that animate character-by-character (a person's prompt and
// the agent's commands); everything else is revealed instantly.
const isTyping = (kind: LineKind) => kind === 'user' || kind === 'cmd'

function lineClass(kind: LineKind) {
  switch (kind) {
    case 'user':
      return `${styles.termLine} ${styles.termUser}`
    case 'agent':
      return `${styles.termLine} ${styles.termAgent}`
    case 'cmd':
      return `${styles.termLine} ${styles.termCmdLine}`
    case 'comment':
      return `${styles.termLine} ${styles.termComment}`
    case 'pass':
    case 'ok':
      return `${styles.termLine} ${styles.termOk}`
    default:
      return `${styles.termLine} ${styles.termOut}`
  }
}

export function LumoTerminal() {
  const [lineIdx, setLineIdx] = useState(0)
  const [typed, setTyped] = useState(0)
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reduced) return
    if (lineIdx >= SCRIPT.length) {
      const t = setTimeout(() => {
        setLineIdx(0)
        setTyped(0)
      }, LOOP_HOLD_MS)
      return () => clearTimeout(t)
    }
    const line = SCRIPT[lineIdx]!
    if (isTyping(line.kind) && typed < line.text.length) {
      const t = setTimeout(() => setTyped(typed + 1), TYPE_MS)
      return () => clearTimeout(t)
    }
    const delay = isTyping(line.kind) ? TYPED_HOLD_MS : OUT_MS
    const t = setTimeout(() => {
      setLineIdx(lineIdx + 1)
      setTyped(0)
    }, delay)
    return () => clearTimeout(t)
  }, [lineIdx, typed, reduced])

  const upTo = reduced ? SCRIPT.length : Math.min(lineIdx + 1, SCRIPT.length)
  const visible = SCRIPT.slice(0, upTo)

  return (
    <section className={styles.termSection}>
      <div className={styles.termInner}>
        <div className={styles.termHead}>
          <div className={styles.eyebrow}>Works inside Claude Code</div>
          <h2 className={styles.h2}>
            Your agent files the task — and closes it.
          </h2>
          <p className={styles.termLede}>
            Point Claude Code at a feature. It creates the Lumo task, loads its
            context, locks the acceptance contract, does the work — and can only
            mark it done once every check provably passes.
          </p>
        </div>

        <div className={styles.termCard}>
          <div className={styles.termBar}>
            <span className={styles.dot} style={{ background: '#e6c2b2' }} />
            <span className={styles.dot} style={{ background: '#eae0cf' }} />
            <span className={styles.dot} style={{ background: '#eae0cf' }} />
            <span className={styles.termBarLabel}>claude code — lumo</span>
          </div>
          <div
            className={styles.termBody}
            aria-label='Claude Code driving Lumo'
          >
            {visible.map((line, i) => {
              const typingNow = !reduced && i === lineIdx && isTyping(line.kind)
              const shown = typingNow ? line.text.slice(0, typed) : line.text
              return (
                <div key={i} className={lineClass(line.kind)}>
                  {line.kind === 'user' && (
                    <span className={styles.termWho}>you</span>
                  )}
                  {line.kind === 'agent' && (
                    <span
                      className={`${styles.termWho} ${styles.termWhoAgent}`}
                    >
                      claude
                    </span>
                  )}
                  {line.kind === 'cmd' && (
                    <span className={styles.termPrompt}>$</span>
                  )}
                  <span className={styles.termText}>{shown || ' '}</span>
                  {typingNow && (
                    <span className={styles.termCursor} aria-hidden='true' />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
