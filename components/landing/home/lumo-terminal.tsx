'use client'

import { useEffect, useState } from 'react'

import { LumoMark } from './icons'
import styles from './home.module.css'

// What working with Lumo actually looks like inside a coding agent: you point it
// at a task with one command, it runs prechecks, then drives the lumo CLI as
// tool calls (attach + context → verify) and reports back — the real agent
// transcript shape, kept model-/tool-neutral ("coding agent"). Commands and
// output are the genuine ones from the lumo skill.
const QUERY = '/lumo LUM-204'

interface ToolStep {
  kind: 'tool'
  name?: string // tool name shown before the args, defaults to "Bash"
  cmd: string
  out: string[]
  more?: string
}
interface SayStep {
  kind: 'say'
  text: string
}
type Step = SayStep | ToolStep

const STEPS: Step[] = [
  {
    kind: 'say',
    text: 'Prechecks (CLI, auth, session), then I’ll start LUM-204.',
  },
  {
    kind: 'tool',
    cmd: 'lumo session attach LUM-204 && lumo task context LUM-204',
    out: [
      'Attached session to LUM-204 “Add Stripe checkout flow”',
      'Loaded context · 6 acceptance criteria · 2 source cards',
    ],
    more: '+18 lines',
  },
  {
    kind: 'say',
    text: 'Contract’s in place. I’ll implement, then verify before calling it done.',
  },
  {
    kind: 'tool',
    name: 'Edit',
    cmd: 'app/api/checkout/route.ts',
    out: ['Added Stripe PaymentIntent, webhook & receipt email'],
    more: '+212 −4 across 3 files',
  },
  {
    kind: 'tool',
    cmd: 'lumo verify LUM-204',
    out: [
      'Verifying LUM-204 — 3 MACHINE criteria',
      '[1/3] Card payment succeeds end-to-end   ✓ PASS',
      '[2/3] Declined cards show a clear error  ✓ PASS',
      '[3/3] Receipts emailed within 30s        ✓ PASS',
      '✓ All criteria passed — task is now IN_REVIEW',
    ],
  },
  {
    kind: 'say',
    text: 'Done — LUM-204 is in review. Every check passed; tokens and time logged.',
  },
]

const TYPE_MS = 34 // per character while typing the prompt
const THINK_MS = 520 // pause before the agent starts
const STEP_MS = 620 // delay between revealed steps
const LOOP_HOLD_MS = 3600 // pause on the final frame before looping

const isOkLine = (l: string) => l.includes('✓') || l.includes('PASS')

export function LumoTerminal() {
  const [qTyped, setQTyped] = useState(0)
  const [revealed, setRevealed] = useState(0)
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
    if (qTyped < QUERY.length) {
      const t = setTimeout(() => setQTyped(qTyped + 1), TYPE_MS)
      return () => clearTimeout(t)
    }
    if (revealed < STEPS.length) {
      const t = setTimeout(
        () => setRevealed(revealed + 1),
        revealed === 0 ? THINK_MS : STEP_MS
      )
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      setQTyped(0)
      setRevealed(0)
    }, LOOP_HOLD_MS)
    return () => clearTimeout(t)
  }, [qTyped, revealed, reduced])

  const query = reduced ? QUERY : QUERY.slice(0, qTyped)
  const typingQuery = !reduced && qTyped < QUERY.length

  return (
    <section className={styles.termSection}>
      <div className={styles.termInner}>
        <div className={styles.termHead}>
          <div className={styles.eyebrow}>Works with your coding agent</div>
          <h2 className={styles.h2}>
            Point your agent at a task. It drives Lumo.
          </h2>
          <p className={styles.termLede}>
            One command runs the whole workflow over Lumo’s CLI — attach, load
            context, verify — and a task can’t be called done until every
            acceptance check provably passes.
          </p>
        </div>

        <div className={styles.termCard}>
          <div className={styles.termBar}>
            <span className={styles.dot} style={{ background: '#ff5f57' }} />
            <span className={styles.dot} style={{ background: '#febc2e' }} />
            <span className={styles.dot} style={{ background: '#28c840' }} />
            <span className={styles.termBarLabel}>
              <LumoMark size={13} className={styles.termBarMark} />
              coding agent · ~/Projects/Lumo
            </span>
          </div>

          <div
            className={styles.termBody}
            aria-label='A coding agent driving Lumo'
          >
            {/* You point the agent at a Lumo task */}
            <div className={styles.termInputRow}>
              <span className={styles.termCaret}>❯</span>
              <span className={styles.termQuery}>{query || ' '}</span>
              {typingQuery && (
                <span className={styles.termCursor} aria-hidden='true' />
              )}
            </div>

            {/* The agent narrates and runs the lumo CLI as tool calls. All
                steps render up front (reserving full height); unrevealed ones
                are just faded out, so the card never grows as lines stream in. */}
            {STEPS.map((step, i) => {
              const hidden = !reduced && i >= revealed
              if (step.kind === 'say') {
                return (
                  <div
                    key={i}
                    className={`${styles.termSay} ${hidden ? styles.termHidden : ''}`}
                  >
                    <span className={styles.termDot} aria-hidden='true'>
                      ⏺
                    </span>
                    <span>{step.text}</span>
                  </div>
                )
              }
              return (
                <div
                  key={i}
                  className={`${styles.termTool} ${hidden ? styles.termHidden : ''}`}
                >
                  <div className={styles.termBash}>
                    <span className={styles.termDot} aria-hidden='true'>
                      ⏺
                    </span>
                    <span>
                      <span className={styles.termBashKw}>
                        {step.name ?? 'Bash'}
                      </span>
                      ({step.cmd})
                    </span>
                  </div>
                  <div className={styles.termOutBlock}>
                    <span className={styles.termConnector} aria-hidden='true'>
                      ⎿
                    </span>
                    <div className={styles.termOutLines}>
                      {step.out.map((l, j) => (
                        <div
                          key={j}
                          className={
                            isOkLine(l) ? styles.termOkLine : undefined
                          }
                        >
                          {l}
                        </div>
                      ))}
                      {step.more && (
                        <div className={styles.termMore}>… {step.more}</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
