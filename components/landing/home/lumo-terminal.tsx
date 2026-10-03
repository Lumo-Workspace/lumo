'use client'

import { useEffect, useRef, useState } from 'react'

import { LumoMark } from './icons'
import { WindowShell } from './window-shell'
import styles from './home.module.css'

// What working with Lumo actually looks like inside a coding agent: you point it
// at a task with one command, it runs prechecks, then drives the lumo CLI as
// tool calls (attach + context → test-case runs → PR scan → wrapup) and reports
// back — the real agent transcript shape, kept model-/tool-neutral ("coding
// agent"). Commands are the genuine ones: `lumo task testcase run <task>/TC<n>
// --result <r> --env <e> [--evidence-file …]`, `lumo pr scan <number>` and
// `lumo task wrapup <task>` all match cli/src/commands/. The run ends IN_REVIEW with findings still open,
// because the agent does not get to close its own task.
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
      'Loaded context · 3 test cases · 2 source cards',
    ],
    more: '+18 lines',
  },
  {
    kind: 'say',
    text: 'Test cases are in place. I’ll implement, then run them before calling it done.',
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
    cmd: 'lumo task testcase run LUM-204/TC1 --result pass --env preview \\\n  --evidence-file step-2.png --evidence-file verify-1.png',
    out: [
      'Uploaded 2 evidence files (png)',
      'Recorded PASS · TC1 · preview · commit 4f2a9c1 (clean)',
    ],
    more: 'TC2, TC3 recorded — 3/3 PASS',
  },
  {
    kind: 'say',
    text: 'Cases pass. Scanning the PR before I hand it back.',
  },
  {
    kind: 'tool',
    cmd: 'lumo pr scan 482',
    out: [
      'Scanning PR #482 — 5 layers',
      'Secrets 1 · Code scan 2 · Dependencies 3 · AI review 1 · Exploit paths 1',
      '⚠ 8 findings — 2 HIGH need a human before merge',
    ],
    more: '+11 lines',
  },
  {
    kind: 'tool',
    cmd: 'lumo task update LUM-204 --status in_review && lumo task wrapup LUM-204',
    out: [
      'LUM-204 → IN_REVIEW',
      '[1/4] Test cases          3/3 PASS with evidence',
      '[2/4] Security scans      PR #482 · 8 open, 2 blocking',
      '[3/4] Boundary crossings  none open',
      '[4/4] Readiness: BLOCKED — a human-only gate would refuse DONE',
    ],
  },
  {
    kind: 'say',
    text: 'LUM-204 is in review: 3/3 cases passed with evidence, 8 scan findings left for you. I can’t close it — that’s yours.',
  },
]

const TYPE_MS = 34 // per character while typing the prompt
const THINK_MS = 520 // pause before the agent starts
const STEP_MS = 620 // delay between revealed steps

const isOkLine = (l: string) => l.includes('✓') || l.includes('PASS')
// A findings line is attention, not success — it must never render green.
const isWarnLine = (l: string) => l.includes('⚠')

export function LumoTerminal() {
  const [qTyped, setQTyped] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const [reduced, setReduced] = useState(false)
  const [inView, setInView] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // Track whether the terminal is on screen. Kept connected (not disconnected
  // after first hit) so it re-fires every time the user scrolls back to it.
  useEffect(() => {
    if (reduced) return
    const el = cardRef.current
    if (!el) return
    const io = new IntersectionObserver(
      entries => setInView(entries.some(e => e.isIntersecting)),
      { threshold: 0.4 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  // Replay from the top each time it (re-)enters view — one play per scroll-in,
  // never an infinite loop while it sits on screen.
  useEffect(() => {
    if (inView) {
      setQTyped(0)
      setRevealed(0)
    }
  }, [inView])

  // Drive the typewriter while in view; hold on the final frame when it ends.
  useEffect(() => {
    if (reduced || !inView) return undefined
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
    // Reached the end — hold on the final frame (no loop).
    return undefined
  }, [qTyped, revealed, reduced, inView])

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
            context, run the test cases, scan the PR — and a task can’t be
            called done on the agent’s word alone.
          </p>
        </div>

        <div className={styles.termScreen}>
          <WindowShell
            variant='terminal'
            cardRef={cardRef}
            bodyClassName={styles.termBody}
            bodyAriaLabel='A coding agent driving Lumo'
            label={
              <span className={styles.termBarLabel}>
                <LumoMark size={13} className={styles.termBarMark} />
                coding agent · ~/Projects/Lumo
              </span>
            }
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
                            isWarnLine(l)
                              ? styles.termWarnLine
                              : isOkLine(l)
                                ? styles.termOkLine
                                : undefined
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
          </WindowShell>
        </div>
      </div>
    </section>
  )
}
