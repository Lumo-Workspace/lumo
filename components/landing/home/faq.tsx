'use client'

import { useState } from 'react'

import styles from './home.module.css'

interface FaqItem {
  q: string
  a: string
}

// Questions phrased the way a visitor would actually type them, and answers
// held to what the code does. Two things this file used to get wrong:
//   - it sold "an LLM judge for the fuzzy ones" and a task auto-moving to
//     Verified. Reference 9 and the Verification card argue the opposite, and
//     a machine pass does not close a task here — a person does.
//   - it named Linear and Notion as integrations. The registry
//     (lib/integrations/registry.ts) is slack, sentry, github, githubAccount,
//     figma, googleDrive — those are the ones named below.
// The encryption sentence is likewise scoped to what lib/crypto.ts actually
// encrypts (third-party credentials), not to "all sensitive data".
// LUM-853: the privacy answer is held to /security and the privacy policy.
//   - no training + zero data retention: lib/ai/zdr-fetch.ts forces
//     providerOptions.gateway.zeroDataRetention on every gateway request;
//     routing is global, so no region is promised (team wording rule).
//   - export names only kinds in EXPORT_KINDS
//     (lib/repositories/workspace-export.repository.ts) — never "everything":
//     agent activity, PR/scan records and several child tables are not in it.
//   - deletion: WORKSPACE_DELETION_GRACE_MS (48h, any owner can cancel), then
//     every row and blob is purged (lib/services/workspace-deletion.service.ts).
//   - not shipped, so not claimed: per-workspace encryption keys, use-then-
//     discard retention, full-record hook mode.
const FAQS: FaqItem[] = [
  {
    q: 'What if the agent just says it’s done?',
    a: 'It cannot close the task on its own word. Every acceptance criterion names the check that proves it, and every test case is run with its result appended — the environment, the commit it ran against, and screenshots as evidence. The run log is append-only, so a wrong verdict is corrected by adding a row, never by quietly editing one. A machine pass moves the task to review; a person closes it.',
  },
  {
    q: 'What happens when the scan finds something?',
    a: 'Every pull request runs five layers before it merges — secrets, code scan, dependencies, AI review, and an agent that hunts for a working exploit path. Each finding lands on the PR with a severity and a fingerprint, and boundary crossings your agents made along the way are recorded separately. A layer that finished means it was checked, not that it was clean: Lumo reports what it established and never claims safety it did not.',
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
    q: 'Do we have to leave the tools we already use?',
    a: 'No. Lumo connects to GitHub, Slack, Figma, Google Drive and Sentry, so humans plan and review where they already work while agents execute against the same source of truth.',
  },
  {
    q: 'Do you train on our code?',
    a: 'No. Neither Lumo nor the model hosts we use train on your data. Every AI request goes through the Vercel AI Gateway with zero data retention enforced on the request itself. Requests are routed globally, so we don’t promise a processing region. Tokens for the tools you connect are encrypted with AES-256-GCM before they are stored. A workspace owner can download an export of the workspace’s projects, tasks, documents, ideas and team memory, or delete the workspace: any owner can cancel within 48 hours, then all of its data and files are permanently deleted. The details are on our Security page.',
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
