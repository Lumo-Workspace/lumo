'use client'

import { useState } from 'react'

import styles from './home.module.css'

type RowKind = 'mono' | 'plain' | 'good'

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

const TABS: HowTab[] = [
  {
    label: 'Plan',
    step: 'Step one',
    title: 'Break work into verifiable tasks.',
    body: 'Define what "done" means up front. Each task carries acceptance criteria your agents — and your reviewers — are held to.',
    points: [
      'Crisp, testable acceptance criteria',
      'Dependencies detected automatically',
      'Roll tasks into sprints & milestones',
    ],
    panelLabel: 'TASK · checkout-revamp',
    rows: [
      { label: 'Acceptance criteria', val: '8 defined', kind: 'mono' },
      { label: 'Complexity', val: 'Medium', kind: 'plain' },
      { label: 'Dependencies', val: '2 resolved', kind: 'plain' },
      { label: 'Assigned to', val: 'agent · sonnet', kind: 'mono' },
    ],
  },
  {
    label: 'Dispatch',
    step: 'Step two',
    title: 'Hand off, and watch the spend.',
    body: 'Send the task to your agents. Lumo meters tokens, runtime, and cost live — so a runaway loop is visible in seconds, not at invoice time.',
    points: [
      'Live token & cost metering',
      'Budget thresholds with alerts',
      'Boundary crossings flagged in real time',
    ],
    panelLabel: 'RUN #4821 · live',
    rows: [
      { label: 'Tokens used', val: '847K / 1M', kind: 'mono' },
      { label: 'Runtime', val: '2h 14m', kind: 'plain' },
      { label: 'Cost so far', val: '$3.41', kind: 'mono' },
      { label: 'Boundary flags', val: '0', kind: 'good' },
    ],
  },
  {
    label: 'Verify',
    step: 'Step three',
    title: 'Ship only what passes.',
    body: 'Every criterion is checked before a task can close. What passes moves to Verified; what fails is returned with the exact gap to fix.',
    points: [
      'Automated + LLM-judged checks',
      'Failed criteria sent back with context',
      'Full verification history per task',
    ],
    panelLabel: 'VERIFICATION · 8/8',
    rows: [
      { label: 'Criteria passed', val: '8 / 8', kind: 'good' },
      { label: 'Judge confidence', val: 'High', kind: 'plain' },
      { label: 'Test tampering', val: 'None', kind: 'good' },
      { label: 'Verdict', val: 'VERIFIED', kind: 'good' },
    ],
  },
]

function rowValClass(kind: RowKind) {
  if (kind === 'mono') return `${styles.howRowVal} ${styles.howRowValMono}`
  if (kind === 'good') return `${styles.howRowVal} ${styles.howRowValGood}`
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
          <h2 className={styles.h2}>Plan it. Dispatch it. Verify it.</h2>
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
