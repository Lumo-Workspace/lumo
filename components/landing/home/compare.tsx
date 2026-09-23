import { Fragment } from 'react'

import styles from './home.module.css'

type Verdict = 'yes' | 'partial' | 'addon' | 'no'

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

interface CompareGroup {
  title: string
  question: string
  rows: CompareRow[]
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
  addon: 'Add-on',
  no: 'No',
}

// Issue tracking comes first to answer "can it replace our tracker?" (Linear
// winning most of that group is expected and left as is); QA (did the
// agent's work really pass?) and security (did it ship a hole?) follow —
// they are what Lumo is for.
//
// The page renders only the verdict (a check, a cross, or the word). Notes
// and sources stay here as the audit trail for each verdict: the
// compare-claims test holds every competitor cell to an official-domain
// source, and the PR's Sources table is generated from this data.
//
// Every competitor cell was read off that vendor's own docs, changelog,
// integration or marketplace page on 2026-09-23 and cites the page it came
// from; the page makes the same promise out loud below the table. Where a
// vendor ships something adjacent (Rovo Dev's AI review, Xray/Zephyr on the
// Marketplace), the cell says "Partly" or "Add-on" and names it rather than
// rounding it down to "No" — the table is only worth publishing if a Jira
// user would agree with their own column. "No" means the vendor's own docs
// describe no such feature as of the check date (product call, LUM-827: a
// feature a vendor doesn't document is one its buyers can't rely on); the
// footnote says so, and the source link shows which page was checked.
//
// Lumo cells are held to what the code does: test tampering, deleted tests
// and weakened criteria are BoundaryCrossingCategory values
// (TEST_TAMPERING / TEST_FILE_DELETED / CONTRACT_WEAKENING); the scan layers
// are SCAN_STAGE_LABELS; the scan gate blocks per the workspace security
// policy (lib/services/pr-security-scan-gate.ts, default deterministic HIGH)
// until a person dispositions the finding; a machine pass moves a task to
// review, not Done.
export const COMPARE_GROUPS: CompareGroup[] = [
  {
    title: 'Issue tracking',
    question: 'And the everyday tracking your team already relies on?',
    rows: [
      {
        capability: 'Issues with priority, tags and sub-tasks',
        lumo: {
          verdict: 'yes',
          note: 'Priority, tags, assignee, due date and sub-tasks.',
        },
        linear: {
          verdict: 'yes',
          note: 'Priority, labels, assignee and sub-issues.',
          source: 'https://linear.app/docs/parent-and-sub-issues',
        },
        jira: {
          verdict: 'yes',
          note: 'Priority, labels, assignee and subtasks built in.',
          source:
            'https://support.atlassian.com/jira-software-cloud/docs/create-a-work-item-and-a-subtask/',
        },
        asana: {
          verdict: 'partial',
          note: 'Tags and subtasks; priority is a custom field on paid plans.',
          source: 'https://asana.com/pricing',
        },
      },
      {
        capability: 'Sprints',
        lumo: {
          verdict: 'yes',
          note: 'Sprints with progress, burnup and blockers.',
        },
        linear: {
          verdict: 'yes',
          note: 'Native cycles; open work rolls over.',
          source: 'https://linear.app/docs/use-cycles',
        },
        jira: {
          verdict: 'partial',
          note: 'Native, but only for Scrum spaces.',
          source:
            'https://support.atlassian.com/jira-software-cloud/docs/what-is-a-sprint/',
        },
        asana: {
          verdict: 'no',
          note: 'A board-and-custom-field template, not a sprint object.',
          source: 'https://asana.com/templates/sprint-planning',
        },
      },
      {
        capability: 'Milestones',
        lumo: {
          verdict: 'yes',
          note: 'Milestones with exit criteria and a changelog of what shipped.',
        },
        linear: {
          verdict: 'yes',
          note: 'Project milestones on the project timeline.',
          source: 'https://linear.app/docs/project-milestones',
        },
        jira: {
          verdict: 'partial',
          note: 'Releases on the timeline; no milestone object.',
          source:
            'https://support.atlassian.com/jira-software-cloud/docs/how-can-i-plan-with-releases-on-my-project-roadmap/',
        },
        asana: {
          verdict: 'yes',
          note: 'Milestones and timeline on paid plans.',
          source: 'https://asana.com/pricing',
        },
      },
      {
        capability: 'Dependencies between tasks',
        lumo: {
          verdict: 'yes',
          note: 'Blocked-by links, plus suggestions detected from mentions and shared files.',
        },
        linear: {
          verdict: 'yes',
          note: 'Blocked-by and blocks relations.',
          source: 'https://linear.app/docs/issue-relations',
        },
        jira: {
          verdict: 'yes',
          note: 'Blocks and is-blocked-by links.',
          source:
            'https://support.atlassian.com/jira-software-cloud/docs/link-issues/',
        },
        asana: {
          verdict: 'yes',
          note: 'Blocked-by dependencies on paid plans.',
          source:
            'https://developers.asana.com/reference/adddependenciesfortask',
        },
      },
      {
        capability: 'Docs next to the work',
        lumo: {
          verdict: 'yes',
          note: 'Docs live in the workspace and link to tasks.',
        },
        linear: {
          verdict: 'yes',
          note: 'Documents inside projects and issues.',
          source: 'https://linear.app/docs/documents',
        },
        jira: {
          verdict: 'partial',
          note: 'Pages run on Confluence, a separate product.',
          source:
            'https://support.atlassian.com/jira-software-cloud/docs/enable-and-disable-pages/',
        },
        asana: {
          verdict: 'partial',
          note: 'One project brief per project.',
          source: 'https://developers.asana.com/reference/project-briefs',
        },
      },
      {
        capability: 'GitHub and Slack',
        lumo: {
          verdict: 'yes',
          note: 'PRs link by branch or task id; Slack threads attach to tasks.',
        },
        linear: {
          verdict: 'yes',
          note: 'PRs link and move issue status; Slack app.',
          source: 'https://linear.app/docs/github',
        },
        jira: {
          verdict: 'yes',
          note: 'GitHub app links PRs by key; Slack app.',
          source:
            'https://support.atlassian.com/jira-cloud-administration/docs/integrate-with-github/',
        },
        asana: {
          verdict: 'partial',
          note: 'GitHub app shows PR status on the task; Slack app.',
          source: 'https://asana.com/apps/github',
        },
      },
    ],
  },
  {
    title: 'QA',
    question: 'The agent says it’s done. Did it actually pass?',
    rows: [
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
          verdict: 'no',
          note: 'No executable acceptance criteria in its product docs.',
          source: 'https://asana.com/product/command',
        },
      },
      {
        capability: 'Test cases with a run log and evidence',
        lumo: {
          verdict: 'yes',
          note: 'Steps and expected result; every run appends its verdict, environment, commit and screenshots.',
        },
        linear: {
          verdict: 'addon',
          note: 'Not native; third-party tools like Testmo link runs to issues.',
          source: 'https://linear.app/integrations/testmo',
        },
        jira: {
          verdict: 'addon',
          note: 'Not native; Marketplace apps like Xray and Zephyr.',
          source: 'https://marketplace.atlassian.com/apps/1213259',
        },
        asana: {
          verdict: 'addon',
          note: 'Not native; third-party apps like Qase.',
          source: 'https://asana.com/apps/qase',
        },
      },
      {
        capability: 'Catches an agent gaming its own tests',
        lumo: {
          verdict: 'yes',
          note: 'Editing a checked test, deleting a test or weakening a criterion is flagged on the task.',
        },
        linear: {
          verdict: 'no',
          note: 'Nothing on checking agent work against its tests.',
          source:
            'https://linear.app/changelog/2026-03-24-introducing-linear-agent',
        },
        jira: {
          verdict: 'no',
          note: 'Rovo Dev review doesn’t describe tamper detection.',
          source: 'https://www.atlassian.com/software/rovo-dev/code-review',
        },
        asana: {
          verdict: 'no',
          note: 'Nothing on tests in Command.',
          source: 'https://asana.com/product/command',
        },
      },
      {
        capability: 'Done needs a human to confirm',
        lumo: {
          verdict: 'yes',
          note: 'A machine pass only reaches review; moving to Done stops for a person to confirm.',
        },
        linear: {
          verdict: 'no',
          note: 'Merging the PR moves the issue to Done; no confirm step.',
          source: 'https://linear.app/docs/github',
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
    ],
  },
  {
    title: 'Security',
    question: 'It shipped the feature. Did it ship a hole with it?',
    rows: [
      {
        capability: 'Secrets, code and dependency scan on the PR',
        lumo: {
          verdict: 'yes',
          note: 'Built in, on every PR; each finding carries a severity and a fingerprint.',
        },
        linear: {
          verdict: 'no',
          note: 'Shows the PR’s overall check status; no scanning.',
          source: 'https://linear.app/docs/diffs',
        },
        jira: {
          verdict: 'partial',
          note: 'Shows findings from Snyk or GitHub; Rovo Dev AI review flags some issues.',
          source:
            'https://support.atlassian.com/jira-cloud-administration/docs/what-is-the-security-feature/',
        },
        asana: {
          verdict: 'no',
          note: 'The GitHub app shows review, build and PR status only.',
          source: 'https://asana.com/apps/github',
        },
      },
      {
        capability: 'An agent that hunts for a working exploit',
        lumo: {
          verdict: 'yes',
          note: 'After AI review, an agent works the diff for an exploit path you could actually hit.',
        },
        linear: {
          verdict: 'no',
          note: 'No security review in Diffs.',
          source: 'https://linear.app/docs/diffs',
        },
        jira: {
          verdict: 'no',
          note: 'Rovo Dev reviews and drafts fixes; no exploit hunting.',
          source: 'https://www.atlassian.com/software/rovo-dev/code-review',
        },
        asana: {
          verdict: 'no',
          note: 'Not described for Command or AI Teammates.',
          source: 'https://asana.com/product/command',
        },
      },
      {
        capability: 'Findings hold the task until a person rules',
        lumo: {
          verdict: 'yes',
          note: 'A blocking finding keeps the task out of Done until someone marks it false positive or accepted risk.',
        },
        linear: {
          verdict: 'no',
          note: 'No security findings to gate on.',
          source: 'https://linear.app/docs/diffs',
        },
        jira: {
          verdict: 'no',
          note: 'Findings can be linked and prioritized; no Done gate described.',
          source:
            'https://support.atlassian.com/jira-software-cloud/docs/manage-security-vulnerabilities-in-jira/',
        },
        asana: {
          verdict: 'no',
          note: 'No security findings to gate on.',
          source: 'https://asana.com/apps/github',
        },
      },
      {
        capability: 'Flags risky agent actions as they happen',
        lumo: {
          verdict: 'yes',
          note: 'A push to a protected branch, a skipped hook or a destructive DB command lands on the task.',
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
          verdict: 'no',
          note: 'AI actions are logged; no rule-break detection described.',
          source: 'https://asana.com/product/ai/ai-teammates',
        },
      },
    ],
  },
]

export const COMPARE_ROWS: CompareRow[] = COMPARE_GROUPS.flatMap(g => g.rows)

/** A check, a cross, or the word — the table shows the verdict and nothing else. */
function Mark({ verdict }: { verdict: Verdict }) {
  if (verdict === 'yes')
    return (
      <span
        className={`${styles.compareMark} ${styles.compareYes}`}
        role='img'
        aria-label='Yes'
      >
        ✓
      </span>
    )
  if (verdict === 'no')
    return (
      <span
        className={`${styles.compareMark} ${styles.compareNo}`}
        role='img'
        aria-label='No'
      >
        ✗
      </span>
    )
  return <span className={styles.compareWord}>{VERDICT_LABEL[verdict]}</span>
}

export function Compare() {
  return (
    <section id='compare' className={styles.sectionPlain}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHeadLeft}>
          <div className={styles.eyebrow}>Lumo vs. Linear, Jira and Asana</div>
          <h2 className={`${styles.h2} ${styles.compareTitle}`}>
            They track the work. Lumo checks it.
          </h2>
          <p className={styles.compareLede}>
            All four can hand a task to a coding agent. Then Linear, Jira and
            Asana stop: at an overall CI badge, an AI review comment, or a
            test-management add-on. Lumo runs the checks itself, and the task
            doesn&apos;t close until they pass and a person signs off.
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
              {COMPARE_GROUPS.map(group => (
                <Fragment key={group.title}>
                  <tr className={styles.compareGroupRow}>
                    <th
                      scope='colgroup'
                      colSpan={COMPETITORS.length + 2}
                      className={styles.compareGroup}
                    >
                      <span className={styles.compareGroupTitle}>
                        {group.title}
                      </span>
                      <span className={styles.compareGroupQuestion}>
                        {group.question}
                      </span>
                    </th>
                  </tr>
                  {group.rows.map(row => (
                    <tr key={row.capability}>
                      <th scope='row' className={styles.compareCap}>
                        {row.capability}
                      </th>
                      <td className={styles.compareLumo}>
                        <Mark verdict={row.lumo.verdict} />
                      </td>
                      {COMPETITORS.map(key => (
                        <td key={key}>
                          <Mark verdict={row[key].verdict} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <p className={styles.compareFootnote}>
          Checked against each vendor&apos;s own docs, integration and
          marketplace pages on September 23, 2026. &ldquo;Partly&rdquo; means
          the feature exists with limits; &ldquo;Add-on&rdquo; means a separate
          third-party app.
        </p>
      </div>
    </section>
  )
}
