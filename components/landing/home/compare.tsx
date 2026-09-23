import styles from './home.module.css'

type Verdict = 'yes' | 'partial' | 'no' | 'undocumented'

interface CompetitorCell {
  verdict: Verdict
  note: string
  /** The vendor page the verdict was read from — every competitor cell has one. */
  source: string
}

interface CompareRow {
  capability: string
  lumo: { verdict: Verdict; note: string }
  linear: CompetitorCell
  jira: CompetitorCell
  asana: CompetitorCell
}

export const COMPETITORS = ['linear', 'jira', 'asana'] as const

export const COMPETITOR_NAMES: Record<(typeof COMPETITORS)[number], string> = {
  linear: 'Linear',
  jira: 'Jira',
  asana: 'Asana',
}

/** The only domains a competitor cell may cite — the vendor's own pages. */
export const OFFICIAL_DOMAINS: Record<(typeof COMPETITORS)[number], string[]> =
  {
    linear: ['linear.app'],
    jira: ['atlassian.com'],
    asana: ['asana.com'],
  }

const VERDICT_LABEL: Record<Verdict, string> = {
  yes: 'Yes',
  partial: 'Partly',
  no: 'No',
  undocumented: 'Not in docs',
}

// Every competitor cell was read off that vendor's own docs, changelog or
// pricing page on 2026-09-23 and cites the page it came from; the page makes
// the same promise out loud below the table. Where a vendor ships something
// adjacent (Rovo's AI acceptance check, Linear's delegated-issue owner), the
// cell says "Partly" and names it rather than rounding it down to "No" — this
// table is only worth publishing if a Linear or Jira user reading it would
// agree with their own column. "Not in docs" means we looked and found
// nothing, which is weaker than "No" and is labelled as such.
// Lumo cells are held to what the code does: the scan gate blocks per the
// workspace security policy (lib/services/pr-security-scan-gate.ts, default
// deterministic HIGH), and a machine pass moves a task to review, not Done.
export const COMPARE_ROWS: CompareRow[] = [
  {
    capability: 'Hand a task to a coding agent',
    lumo: {
      verdict: 'yes',
      note: 'Claude Code, Codex, Cursor, Copilot and more pull the assembled task context from the CLI.',
    },
    linear: {
      verdict: 'yes',
      note: 'Delegate an issue to Cursor, Codex, Copilot and others.',
      source: 'https://linear.app/docs/agents-in-linear',
    },
    jira: {
      verdict: 'yes',
      note: 'Assign a work item to Claude, Cursor, Codex, Copilot or Rovo Dev.',
      source: 'https://www.atlassian.com/software/jira/dev',
    },
    asana: {
      verdict: 'partial',
      note: 'Command by Asana, Enterprise plans only.',
      source: 'https://asana.com/product/command',
    },
  },
  {
    capability: 'Acceptance criteria that actually run',
    lumo: {
      verdict: 'yes',
      note: 'Each criterion names a check; every run records pass or fail with evidence.',
    },
    linear: {
      verdict: 'no',
      note: 'Coding sessions can test and screenshot, but nothing is scored per criterion.',
      source: 'https://linear.app/docs/coding-sessions',
    },
    jira: {
      verdict: 'partial',
      note: 'Rovo Dev has an AI read the PR against the criteria. Advisory, and no tests run.',
      source:
        'https://support.atlassian.com/rovo/docs/check-acceptance-criteria-in-a-code-review/',
    },
    asana: {
      verdict: 'undocumented',
      note: 'No executable acceptance criteria in its product docs.',
      source: 'https://asana.com/product/command',
    },
  },
  {
    capability: 'An agent can’t close its own task',
    lumo: {
      verdict: 'yes',
      note: 'A machine pass moves the task to review. A person closes it.',
    },
    linear: {
      verdict: 'partial',
      note: 'A delegated issue keeps a human owner; merging still auto-closes it.',
      source: 'https://linear.app/docs/agents-in-linear',
    },
    jira: {
      verdict: 'partial',
      note: 'Possible if you add an approval step to the workflow yourself.',
      source:
        'https://www.atlassian.com/software/jira/guides/agentic-engineering/guardrails-and-safety',
    },
    asana: {
      verdict: 'partial',
      note: 'AI Teammates have human review checkpoints.',
      source: 'https://asana.com/product/ai/ai-teammates',
    },
  },
  {
    capability: 'PR security scan that holds the task open',
    lumo: {
      verdict: 'yes',
      note: 'Five layers on every PR; blocking findings keep the task out of Done until a person rules.',
    },
    linear: {
      verdict: 'no',
      note: 'Diffs reviews code in Linear; no security scanning.',
      source: 'https://linear.app/changelog/2026-05-27-linear-diffs',
    },
    jira: {
      verdict: 'partial',
      note: 'Rovo Dev flags vulnerabilities as advice; the Security tab shows Snyk or GitHub findings.',
      source: 'https://www.atlassian.com/software/rovo-dev/code-review',
    },
    asana: {
      verdict: 'no',
      note: 'The GitHub widget shows review and build status only.',
      source: 'https://help.asana.com/s/article/github-and-asana-integration',
    },
  },
  {
    capability: 'Flags agents that break project rules',
    lumo: {
      verdict: 'yes',
      note: 'Boundary crossings, like a rewritten test or a bypassed hook, land on the task.',
    },
    linear: {
      verdict: 'no',
      note: 'Agent guidance is instructions only; nothing checks it was followed.',
      source: 'https://linear.app/docs/agents-in-linear',
    },
    jira: {
      verdict: 'no',
      note: 'Permissions and an audit trail; no detection of rule breaks.',
      source:
        'https://www.atlassian.com/software/jira/guides/agentic-engineering/guardrails-and-safety',
    },
    asana: {
      verdict: 'undocumented',
      note: 'AI actions are logged; no rule-break detection described.',
      source: 'https://asana.com/product/ai/ai-teammates',
    },
  },
  {
    capability: 'Team memory agents reuse',
    lumo: {
      verdict: 'yes',
      note: 'What one run learns is shared with the team and fed into the next task’s context.',
    },
    linear: {
      verdict: 'partial',
      note: 'Admin-written guidance; the agent does not learn across sessions.',
      source: 'https://linear.app/docs/linear-agent',
    },
    jira: {
      verdict: 'partial',
      note: 'Rovo Dev CLI memory lives in local AGENTS.md files.',
      source:
        'https://support.atlassian.com/rovo/docs/use-memory-in-rovo-dev-cli/',
    },
    asana: {
      verdict: 'partial',
      note: 'Shared memory in Command, Enterprise plans only.',
      source: 'https://asana.com/product/command',
    },
  },
  {
    capability: 'Agent cost per task',
    lumo: {
      verdict: 'yes',
      note: 'Tokens and dollars per task, per agent and per sprint.',
    },
    linear: {
      verdict: 'partial',
      note: 'Usage by model; no per-issue rollup.',
      source: 'https://linear.app/changelog/2026-08-20-coding-environments',
    },
    jira: {
      verdict: 'partial',
      note: 'Sessions listed per work item; credits tracked per user, not per item.',
      source:
        'https://support.atlassian.com/jira-software-cloud/docs/view-and-manage-agent-sessions-in-jira/',
    },
    asana: {
      verdict: 'no',
      note: 'Priced per AI request; no per-task cost view.',
      source: 'https://asana.com/pricing',
    },
  },
  {
    capability: 'Sprints, milestones and docs',
    lumo: { verdict: 'yes', note: 'All three, on the same tasks.' },
    linear: {
      verdict: 'yes',
      note: 'Cycles, project milestones and documents.',
      source: 'https://linear.app/docs/use-cycles',
    },
    jira: {
      verdict: 'partial',
      note: 'Sprints and timeline; docs live in Confluence.',
      source:
        'https://support.atlassian.com/jira-cloud-administration/docs/explore-jira-cloud-plans/',
    },
    asana: {
      verdict: 'partial',
      note: 'Milestones native; sprints are a board pattern, no docs product.',
      source: 'https://asana.com/pricing',
    },
  },
]

function verdictClass(verdict: Verdict): string | undefined {
  if (verdict === 'yes') return `${styles.compareVerdict} ${styles.compareYes}`
  if (verdict === 'no' || verdict === 'undocumented')
    return `${styles.compareVerdict} ${styles.compareNo}`
  return styles.compareVerdict
}

export function Compare() {
  return (
    <section id='compare' className={styles.sectionPlain}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHeadLeft}>
          <div className={styles.eyebrow}>Head to head</div>
          <h2 className={styles.h2}>Lumo vs. Linear, Jira and Asana.</h2>
          <p className={styles.compareLede}>
            All four can hand work to an agent. The difference is what happens
            when the agent says it&apos;s done. Linear, Jira and Asana are
            broader tools for planning; Lumo is built for checking the work.
          </p>
        </div>

        <div className={styles.compareScroll}>
          <table className={styles.compareTable}>
            <thead>
              <tr>
                <th scope='col' className={styles.compareCap}>
                  Capability
                </th>
                <th
                  scope='col'
                  className={`${styles.compareLumo} ${styles.compareLumoHead}`}
                >
                  Lumo
                </th>
                {COMPETITORS.map(key => (
                  <th key={key} scope='col'>
                    {COMPETITOR_NAMES[key]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(row => (
                <tr key={row.capability}>
                  <th scope='row' className={styles.compareCap}>
                    {row.capability}
                  </th>
                  <td className={styles.compareLumo} data-label='Lumo'>
                    <span className={verdictClass(row.lumo.verdict)}>
                      {VERDICT_LABEL[row.lumo.verdict]}
                    </span>
                    <span className={styles.compareNote}>{row.lumo.note}</span>
                  </td>
                  {COMPETITORS.map(key => {
                    const cell = row[key]
                    return (
                      <td key={key} data-label={COMPETITOR_NAMES[key]}>
                        <span className={verdictClass(cell.verdict)}>
                          {VERDICT_LABEL[cell.verdict]}
                        </span>
                        <span className={styles.compareNote}>
                          {cell.note}{' '}
                          <a
                            href={cell.source}
                            className={styles.compareSource}
                            target='_blank'
                            rel='noopener noreferrer'
                            aria-label={`${COMPETITOR_NAMES[key]} source for ${row.capability}`}
                          >
                            source
                          </a>
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className={styles.compareFootnote}>
          Checked against each vendor&apos;s own docs, changelog and pricing
          pages on September 23, 2026 — every cell links to the page it came
          from. &ldquo;Not in docs&rdquo; means we looked and found nothing, not
          that the feature can&apos;t exist. These products ship fast; if a cell
          is out of date, the source link is the tiebreaker.
        </p>
      </div>
    </section>
  )
}
