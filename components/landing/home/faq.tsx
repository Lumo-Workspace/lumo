'use client'

import { useState } from 'react'

import styles from './home.module.css'

interface FaqItem {
  q: string
  a: string
}

const FAQS: FaqItem[] = [
  {
    q: 'How does Lumo verify an agent actually built the right thing?',
    a: 'You attach acceptance criteria to every task. When an agent reports done, Lumo runs each criterion — tests, checks, and an LLM judge for the fuzzy ones — and only moves the task to Verified when all of them pass. Anything that fails is sent back with the specific gap.',
  },
  {
    q: 'Which agents and models does Lumo work with?',
    a: 'Lumo is model-agnostic. Point it at Claude, GPT, your own fine-tunes, or a mix — it meters tokens and time for each and keeps the verification layer identical regardless of who did the work.',
  },
  {
    q: 'How are tokens, time, and cost tracked?',
    a: 'Every run reports usage back to Lumo automatically. You get live per-task, per-agent, and per-sprint rollups for tokens, runtime, and dollar cost, with budget thresholds that alert before a run overspends.',
  },
  {
    q: 'Can my team keep using the tools we already have?',
    a: 'Yes. Lumo plugs into GitHub, Linear, Slack, Notion and more, so humans plan and review where they already work while agents execute against the same source of truth.',
  },
  {
    q: 'Is our code and data secure?',
    a: 'Sensitive data is encrypted at rest with AES-256-GCM, access is scoped per team, and you can export or delete everything on demand. Lumo never trains on your repositories.',
  },
]

export function Faq() {
  const [open, setOpen] = useState(0)

  return (
    <section id='faq' className={styles.sectionAlt}>
      <div className={styles.faqWrap}>
        <h2 className={styles.faqTitle}>Questions, answered.</h2>
        <div className={styles.faqList}>
          {FAQS.map((f, i) => {
            const isOpen = open === i
            return (
              <div key={f.q} className={styles.faqItem}>
                <button
                  type='button'
                  className={styles.faqBtn}
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  <span className={styles.faqQ}>{f.q}</span>
                  <span className={styles.faqSign} aria-hidden='true'>
                    {isOpen ? '–' : '+'}
                  </span>
                </button>
                {isOpen && <div className={styles.faqA}>{f.a}</div>}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
