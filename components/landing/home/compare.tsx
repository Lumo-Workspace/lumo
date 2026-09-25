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
  coderabbit: CompetitorCell
  qawolf: CompetitorCell
}

interface CompareGroup {
  title: string
  question: string
  rows: CompareRow[]
}

export const COMPETITORS = ['linear', 'qawolf', 'coderabbit'] as const

export const COMPETITOR_NAMES: Record<(typeof COMPETITORS)[number], string> = {
  linear: 'Linear',
  coderabbit: 'CodeRabbit',
  qawolf: 'QA Wolf',
}

/** The only domains a competitor cell may cite — the vendor's own pages. */
export const OFFICIAL_DOMAINS: Record<(typeof COMPETITORS)[number], string[]> =
  {
    linear: ['linear.app'],
    coderabbit: ['coderabbit.ai'],
    qawolf: ['qawolf.com'],
  }

const VERDICT_LABEL: Record<Verdict, string> = {
  yes: 'Yes',
  partial: 'Partly',
  addon: 'Add-on',
  no: 'No',
}

// One column per lane Lumo covers: Linear for tracking, QA Wolf for QA,
// CodeRabbit for PR review and security — the best-known name in each
// (LUM-827 follow-up; it replaced a Linear/Jira/Asana line-up that only
// covered tracking). Each specialist is expected to win or tie its own group
// and lose the others; the point is that Lumo covers all three on one task.
// Each of the QA and review groups opens with the specialist's home-turf rows
// (Lumo honestly takes ✗ there), so their columns read like their product,
// not like a quiz written for Lumo; Lumo's own rows follow.
// Issue tracking comes first to answer "can it replace our tracker?"; QA (did
// the agent's work really pass?) and security (did it ship a hole?) follow.
//
// The page renders only the verdict (a check, a cross, or the word). Notes
// and sources stay here as the audit trail for each verdict: the
// compare-claims test holds every competitor cell to an official-domain
// source, and the PR's Sources table is generated from this data.
//
// Every competitor cell was read off that vendor's own docs, changelog,
// integration or marketplace page on 2026-09-24 and cites the page it came
// from; the page makes the same promise out loud below the table. Where a
// vendor ships something adjacent (CodeRabbit's issue assessment and Deep
// Scan, QA Wolf's blocking-bug gate), the cell says "Partly" or "Add-on" and
// names it rather than rounding it down to "No" — the table is only worth
// publishing if a CodeRabbit or QA Wolf user would agree with their own column. "No" means the vendor's own docs
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
        coderabbit: {
          verdict: 'no',
          note: 'No tracker of its own; it reads issues from Jira, Linear and GitHub.',
          source: 'https://docs.coderabbit.ai/issues/planner/index',
        },
        qawolf: {
          verdict: 'partial',
          note: 'Bug reports carry a priority; no general issues, tags or sub-tasks.',
          source: 'https://docs.qawolf.com/v0-ci-greenlight.md',
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
        coderabbit: {
          verdict: 'no',
          note: 'No sprints; its issue features sit on top of an outside tracker.',
          source: 'https://docs.coderabbit.ai/issues/planner/index',
        },
        qawolf: {
          verdict: 'no',
          note: 'No sprints; the docs cover test flows, runs and triggers.',
          source: 'https://docs.qawolf.com/integrations.md',
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
        coderabbit: {
          verdict: 'no',
          note: 'No milestones; planning depends on an outside tracker.',
          source: 'https://docs.coderabbit.ai/issues/planner/index',
        },
        qawolf: {
          verdict: 'no',
          note: 'No milestones; the nearest thing is the coverage outline.',
          source: 'https://docs.qawolf.com/Glossary.md',
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
        coderabbit: {
          verdict: 'no',
          note: 'Maps code dependencies, not links between work items.',
          source: 'https://docs.coderabbit.ai/issues/planner/index',
        },
        qawolf: {
          verdict: 'no',
          note: 'Run rules order test flows; no links between work items.',
          source: 'https://docs.qawolf.com/Glossary.md',
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
        coderabbit: {
          verdict: 'no',
          note: 'A knowledge base it reads for context; no docs you write.',
          source: 'https://docs.coderabbit.ai/knowledge-base/index',
        },
        qawolf: {
          verdict: 'no',
          note: 'Test specs live in flow headers; no docs feature.',
          source: 'https://docs.qawolf.com/test-automation.md',
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
        coderabbit: {
          verdict: 'partial',
          note: 'Native GitHub app; the Slack agent is early access and billed separately.',
          source: 'https://docs.coderabbit.ai/slack-agent/index',
        },
        qawolf: {
          verdict: 'partial',
          note: 'A results check on GitHub PRs and a shared Slack channel; no work items to link.',
          source:
            'https://docs.qawolf.com/legacy-triggers/PR-testing-for-GitHub-Integrations.md',
        },
      },
    ],
  },
  {
    title: 'QA',
    question: 'The agent says it’s done. Did it actually pass?',
    rows: [
      {
        capability: 'Writes and maintains E2E tests for you',
        lumo: {
          verdict: 'no',
          note: 'Records the tests your agent or team writes; it doesn’t author them.',
        },
        linear: {
          verdict: 'no',
          note: 'Linear Agent writes code from an issue; test authoring isn’t described.',
          source: 'https://linear.app/now/coding-sessions-for-linear-agent',
        },
        qawolf: {
          verdict: 'yes',
          note: 'Its QA engineers write the suite, with unlimited maintenance.',
          source: 'https://www.qawolf.com/service',
        },
        coderabbit: {
          verdict: 'partial',
          note: 'Generates unit tests only, not end-to-end tests. Beta.',
          source:
            'https://docs.coderabbit.ai/finishing-touches/unit-test-generation',
        },
      },
      {
        capability: 'Runs the whole suite on its own infrastructure',
        lumo: {
          verdict: 'partial',
          note: 'The CLI runs each criterion’s check on your machine and reads CI results; no hosted runner.',
        },
        linear: {
          verdict: 'no',
          note: 'Coding sessions run in the cloud; running your test suite isn’t described.',
          source: 'https://linear.app/now/coding-sessions-for-linear-agent',
        },
        qawolf: {
          verdict: 'yes',
          note: 'Fully parallel runs on pre-warmed browsers and devices.',
          source: 'https://www.qawolf.com/',
        },
        coderabbit: {
          verdict: 'partial',
          note: 'Runs your existing tests only to verify its Simplify Code changes.',
          source: 'https://www.coderabbit.ai/blog/introducing-simplify-code',
        },
      },
      {
        capability: 'Failures triaged by QA engineers for you',
        lumo: {
          verdict: 'no',
          note: 'A person on your team must rule on each failure; nobody triages it for you.',
        },
        linear: {
          verdict: 'no',
          note: 'Agents are app users you assign; no human QA service.',
          source: 'https://linear.app/docs/agents-in-linear',
        },
        qawolf: {
          verdict: 'yes',
          note: 'Humans reproduce failures and flag only verified bugs.',
          source: 'https://www.qawolf.com/service',
        },
        coderabbit: {
          verdict: 'no',
          note: 'Triage is done by AI; no human QA staff described.',
          source: 'https://www.coderabbit.ai/',
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
        coderabbit: {
          verdict: 'partial',
          note: 'An AI reads the PR against the linked issue. Advisory, and no check runs per criterion.',
          source: 'https://docs.coderabbit.ai/integrations/issue-integrations',
        },
        qawolf: {
          verdict: 'partial',
          note: 'An approved test plan becomes runnable flows, but not tied to a task’s criteria.',
          source: 'https://docs.qawolf.com/onboarding-to-full-service.md',
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
        coderabbit: {
          verdict: 'no',
          note: 'Generates unit test code; no test cases or run log.',
          source:
            'https://docs.coderabbit.ai/finishing-touches/unit-test-generation',
        },
        qawolf: {
          verdict: 'yes',
          note: 'Flows with steps and assertions; every run keeps video, logs and traces.',
          source: 'https://www.qawolf.com/run-infra',
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
        coderabbit: {
          verdict: 'no',
          note: 'Nothing built in; you could only write a custom pre-merge check.',
          source: 'https://docs.coderabbit.ai/pr-reviews/pre-merge-checks',
        },
        qawolf: {
          verdict: 'partial',
          note: 'Its engineers review its own AI’s test edits; your agent’s edits go unchecked.',
          source:
            'https://www.qawolf.com/blog/the-qa-wolf-advantage-vertical-integration-for-superior-qa',
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
        coderabbit: {
          verdict: 'no',
          note: 'No notion of Done; failed checks can be overridden, passes need no sign-off.',
          source: 'https://docs.coderabbit.ai/pr-reviews/pre-merge-checks',
        },
        qawolf: {
          verdict: 'no',
          note: 'Humans check failures, but a clean run passes the gate with no sign-off.',
          source: 'https://docs.qawolf.com/v0-ci-greenlight.md',
        },
      },
    ],
  },
  {
    title: 'Code review & security',
    question: 'It shipped the feature. Did it ship a bug or a hole with it?',
    rows: [
      {
        capability: 'Reviews the whole diff for bugs, not only security',
        lumo: {
          verdict: 'no',
          note: 'Its AI review looks for security issues only.',
        },
        linear: {
          verdict: 'partial',
          note: 'Diffs’ guided reviews explain the PR but don’t flag bugs. Beta, paid plans.',
          source: 'https://linear.app/changelog/2026-05-27-linear-diffs',
        },
        qawolf: {
          verdict: 'no',
          note: 'Runs regression tests after a PR opens; doesn’t review the code.',
          source: 'https://www.qawolf.com/how-it-works',
        },
        coderabbit: {
          verdict: 'yes',
          note: 'AI PR review catches logic bugs, not just security issues.',
          source: 'https://www.coderabbit.ai/',
        },
      },
      {
        capability: 'Catches leaked secrets and vulnerable code in the PR',
        lumo: {
          verdict: 'yes',
          note: 'Built in, on every PR: leaked keys, vulnerable code and vulnerable dependencies, each with a severity.',
        },
        linear: {
          verdict: 'no',
          note: 'Shows the PR’s overall check status; no scanning.',
          source: 'https://linear.app/docs/diffs',
        },
        coderabbit: {
          verdict: 'yes',
          note: 'Secret scanners, Semgrep/OpenGrep and OSV-Scanner run on every review.',
          source: 'https://docs.coderabbit.ai/tools/list',
        },
        qawolf: {
          verdict: 'no',
          note: 'PR testing runs functional end-to-end tests only.',
          source: 'https://www.qawolf.com/solutions/pull-request-testing',
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
        coderabbit: {
          verdict: 'partial',
          note: 'Deep Scan rates reachability, but exploits stay theoretical. Whole repo, beta.',
          source: 'https://docs.coderabbit.ai/security/index',
        },
        qawolf: {
          verdict: 'no',
          note: 'Its agents map the app and write functional tests; no exploit hunting.',
          source: 'https://www.qawolf.com/automation-ai',
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
        coderabbit: {
          verdict: 'partial',
          note: 'Request changes blocks merge, but an approve command or a later fix clears it.',
          source:
            'https://docs.coderabbit.ai/pr-reviews/request-changes-workflow',
        },
        qawolf: {
          verdict: 'partial',
          note: 'Blocking bugs hold the CI gate until fixed or deprioritized; bugs only, not security.',
          source: 'https://docs.qawolf.com/v0-ci-greenlight.md',
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
        coderabbit: {
          verdict: 'no',
          note: 'Its Claude Code integration triggers reviews; it doesn’t watch the agent.',
          source: 'https://docs.coderabbit.ai/cli/claude-code-integration',
        },
        qawolf: {
          verdict: 'no',
          note: 'Its MCP lets agents trigger runs; nothing watches what they do.',
          source: 'https://docs.qawolf.com/integrations.md',
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
          <div className={styles.eyebrow}>
            Lumo vs. Linear, QA Wolf and CodeRabbit
          </div>
          <h2 className={`${styles.h2} ${styles.compareTitle}`}>
            Three tools, one lane each. Lumo runs all three.
          </h2>
          <p className={styles.compareLede}>
            Linear tracks the task, QA Wolf tests the build, CodeRabbit reviews
            the PR, and none of them sees what the others found. Lumo tracks,
            tests and scans the same task, and it doesn&apos;t close until the
            checks pass and a person signs off.
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
          marketplace pages on September 24, 2026. &ldquo;Partly&rdquo; means
          the feature exists with limits; &ldquo;Add-on&rdquo; means a separate
          third-party app.
        </p>
      </div>
    </section>
  )
}
