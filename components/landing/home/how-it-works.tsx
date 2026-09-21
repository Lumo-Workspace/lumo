'use client'

import { useState } from 'react'

import styles from './home.module.css'

type RowKind = 'mono' | 'plain' | 'good' | 'warn'

interface HowRow {
  label: string
  val: string
  kind: RowKind
}

interface HowTab {
  label: string
  step: string
  title: string
  body: string
  points: string[]
  panelLabel: string
  rows: HowRow[]
}

// The three beats have to agree with the rest of the page, which they did not:
// step three used to sell an LLM judge and a "judge confidence" reading, while
// the Verification card (and reference 9) now argue the opposite — a judge's
// self-assessment is the thing being replaced, not the proof. Step three is
// therefore test cases + scan findings, and the panels no longer show a clean
// board: run #4821 raises boundary flags on the Guardrails card and PR #482
// carries 8 findings on the Security card, so those same numbers appear here.
// The last row is deliberately not "VERIFIED": a machine pass does not close a
// task — a person does.
const TABS: HowTab[] = [
  {
    label: 'Define',
    step: 'Step one',
    title: 'Agree on done before the agent starts.',
    body: 'Write down what "done" means before anyone writes code — the criteria, and the test cases that prove them. After that, done stops being a matter of opinion.',
    points: [
      'Acceptance criteria agreed up front',
      'Test cases written before the code',
      'Dependencies detected automatically',
    ],
    panelLabel: 'TASK · checkout-revamp',
    rows: [
      { label: 'Acceptance criteria', val: '8 defined', kind: 'mono' },
      { label: 'Test cases', val: '3 written', kind: 'mono' },
      { label: 'Dependencies', val: '2 resolved', kind: 'plain' },
      { label: 'Assigned to', val: 'agent · sonnet', kind: 'mono' },
    ],
  },
  {
    label: 'Run',
    step: 'Step two',
    title: 'Hand it off, and watch what it touches.',
    body: 'Send the task to your agents. Every boundary the run crosses — a rewritten test, a key pasted into config, a force-push at main — is recorded the moment it happens. Tokens, runtime, and cost are metered alongside it, so a runaway loop shows up in seconds rather than on the invoice.',
    points: [
      'Boundary crossings recorded as they happen',
      'Live token, runtime & cost metering',
      'Budget thresholds with alerts',
    ],
    panelLabel: 'RUN #4821 · live',
    rows: [
      { label: 'Boundary flags', val: '3 recorded', kind: 'warn' },
      { label: 'Tokens used', val: '847K / 1M', kind: 'mono' },
      { label: 'Runtime', val: '2h 14m', kind: 'plain' },
      { label: 'Cost so far', val: '$3.41', kind: 'mono' },
    ],
  },
  {
    label: 'Prove',
    step: 'Step three',
    title: 'Nothing closes on the agent’s word.',
    body: 'Every test case is run and the result is kept with its evidence. Every pull request is scanned. What fails comes back with the exact gap — and passing the machine checks still is not the same as being done.',
    points: [
      'Test results kept with their evidence',
      'Pull requests scanned before they merge',
      'A person closes the task, not the agent',
    ],
    panelLabel: 'VERIFICATION · LUM-204',
    rows: [
      { label: 'Test cases', val: '3 / 3 PASS', kind: 'good' },
      { label: 'Evidence', val: '4 screenshots', kind: 'mono' },
      { label: 'Scan findings', val: '8 open', kind: 'warn' },
      { label: 'Status', val: 'IN REVIEW', kind: 'plain' },
    ],
  },
]

function rowValClass(kind: RowKind) {
  if (kind === 'mono') return `${styles.howRowVal} ${styles.howRowValMono}`
  if (kind === 'good') return `${styles.howRowVal} ${styles.howRowValGood}`
  if (kind === 'warn') return `${styles.howRowVal} ${styles.howRowValWarn}`
  return styles.howRowVal
}

export function HowItWorks() {
  const [active, setActive] = useState(0)
  const tab = TABS[active]!

  return (
    <section id='how' className={styles.sectionPlain}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHeadCenter}>
          <div className={styles.eyebrow}>How it works</div>
          <h2 className={styles.h2}>
            Define done. Let it run. Check the proof.
          </h2>
        </div>

        <div
          className={styles.tabsRow}
          role='tablist'
          aria-label='How Lumo works'
        >
          {TABS.map((t, i) => (
            <button
              key={t.label}
              type='button'
              role='tab'
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`${styles.tab} ${i === active ? styles.tabActive : ''}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.howGrid}>
          {/* `key` re-triggers the fade animation on tab change. */}
          <div key={`copy-${active}`} className={styles.fade}>
            <div className={styles.howStep}>{tab.step}</div>
            <h3 className={styles.howTitle}>{tab.title}</h3>
            <p className={styles.howBody}>{tab.body}</p>
            <div className={styles.howPoints}>
              {tab.points.map(p => (
                <div key={p} className={styles.howPoint}>
                  <span>—</span>
                  {p}
                </div>
              ))}
            </div>
          </div>

          <div
            key={`panel-${active}`}
            className={`${styles.howPanel} ${styles.fade}`}
          >
            <div className={styles.howPanelLabel}>{tab.panelLabel}</div>
            {tab.rows.map(r => (
              <div key={r.label} className={styles.howRow}>
                <span className={styles.howRowLabel}>{r.label}</span>
                <span className={rowValClass(r.kind)}>{r.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
