import Link from 'next/link'

import { Compare } from './compare'
import { Faq } from './faq'
import { HowItWorks } from './how-it-works'
import { LumoTerminal } from './lumo-terminal'
import {
  ClaudeIcon,
  DocumentIcon,
  DriveIcon,
  FigmaIcon,
  GitHubIcon,
  GlobeIcon,
  LumoMark,
  NotionIcon,
  PullRequestIcon,
  SlackIcon,
  SpecIcon,
} from './icons'
import { WindowShell } from './window-shell'
import styles from './home.module.css'

/**
 * Superscript citation linking to the References band. The numbers on this page
 * are effects measured in *published research* on the techniques Lumo is built
 * on — never Lumo's own results — so every figure carries one of these.
 */
function Cite({ n }: { n: number }) {
  return (
    <a href='#references' className={styles.cite} aria-label={`Reference ${n}`}>
      {n}
    </a>
  )
}

const DISCORD_URL = 'https://discord.gg/D7AYBagRk'

function Navbar() {
  return (
    <nav className={styles.nav}>
      <div className={styles.navInner}>
        <a href='#top' className={styles.brand}>
          <LumoMark size={24} style={{ display: 'block', flex: 'none' }} />
          <span className={styles.brandName}>Lumo</span>
        </a>
        <div className={styles.navLinks}>
          <a
            href='#features'
            className={`${styles.navLink} ${styles.navLinkHideSm}`}
          >
            Features
          </a>
          <a
            href='#how'
            className={`${styles.navLink} ${styles.navLinkHideSm}`}
          >
            How it works
          </a>
          <a
            href='#compare'
            className={`${styles.navLink} ${styles.navLinkHideSm}`}
          >
            Compare
          </a>
          <a
            href='#faq'
            className={`${styles.navLink} ${styles.navLinkHideSm}`}
          >
            FAQ
          </a>
          <a
            href={DISCORD_URL}
            target='_blank'
            rel='noopener noreferrer'
            className={`${styles.navLink} ${styles.navLinkHideSm}`}
          >
            Discord
          </a>
          <Link href='/signin' className={styles.navLink}>
            Sign in
          </Link>
          <Link href='/signup' className={styles.btnPrimary}>
            Start free
          </Link>
        </div>
      </div>
    </nav>
  )
}

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroGrid}>
        <div className={styles.heroCopy}>
          <div className={styles.eyebrow}>Agentic Project Management</div>
          <h1 className={styles.heroTitle}>
            <span className={styles.heroTitleSentence}>
              Your agents got 10x faster.
            </span>
            <span className={styles.heroTitleSentence}>
              Your review didn&apos;t.
            </span>
          </h1>
          <p className={styles.heroLede}>
            Lumo is the Agentic Project Management tool for teams that ship with
            Coding Agent. <span className={styles.ledeKey}>Reliable</span>:
            every test case your agent runs is recorded with its result,
            environment and evidence — on every change.{' '}
            <span className={styles.ledeKey}>Secure</span>: every pull request
            is scanned before it merges — for vulnerabilities, and for the
            boundaries your agents crossed writing it. You review the proof, not
            the diff.
          </p>
          <div className={styles.heroActions}>
            <Link
              href='/signup'
              className={`${styles.btnPrimary} ${styles.btnPrimaryLg}`}
            >
              Start for free
            </Link>
            <a href='#how' className={styles.btnOutline}>
              Book a demo
            </a>
          </div>
          <div className={styles.heroNote}>
            No credit card · Free for teams up to 5
          </div>
        </div>

        <div className={styles.heroMockup}>
          <WindowShell
            variant='mock'
            bodyClassName={styles.mockBody}
            label={
              <>
                <LumoMark
                  size={13}
                  style={{ display: 'block', flex: 'none', marginLeft: 10 }}
                />
                <span className={styles.mockPath}>lumo / checkout-revamp</span>
              </>
            }
          >
            <div className={styles.mockHead}>
              <span className={styles.mockTitle}>
                Implement Stripe checkout flow
              </span>
              <span className={styles.badgeReview}>IN REVIEW</span>
            </div>
            <div className={styles.mockSub}>
              Agent · claude-sonnet · run #4821
            </div>

            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>TEST CASES</div>
                <div className={styles.metricValue}>
                  3<span> / 3 PASS</span>
                </div>
                <div className={styles.metricSub}>4 screenshots attached</div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>PR SCAN</div>
                <div className={styles.metricValue}>8</div>
                <div className={styles.metricSub}>findings · 2 HIGH</div>
              </div>
            </div>

            <div className={styles.acLabel}>WHAT&apos;S LEFT FOR YOU</div>
            <div className={styles.acList}>
              {HERO_HANDOFF.map(({ open, text, source }) => (
                <div key={text} className={styles.acItem}>
                  <span className={open ? styles.acWarn : styles.acCheck}>
                    {open ? '!' : '\u2713'}
                  </span>
                  {text}
                  <span className={styles.acSource}>{source}</span>
                </div>
              ))}
            </div>

            <div className={styles.mockFoot}>
              847K tokens &middot; 2h 14m &middot; $3.41
            </div>
          </WindowShell>
        </div>
      </div>
    </section>
  )
}

// What the hero card hands back. Deliberately NOT a clean board: the page's
// whole argument is that a machine pass is not a closing, so the badge reads
// IN REVIEW and the two open rows come first. The three rows are the same run
// the feature cards below describe — 3/3 test cases with evidence, PR #482's
// 8 findings, and one of run #4821's boundary crossings.
const HERO_HANDOFF = [
  {
    open: true,
    text: '2 HIGH scan findings need a decision',
    source: 'PR #482',
  },
  {
    open: true,
    text: 'Boundary crossing: a test file was deleted',
    source: 'run #4821',
  },
  {
    open: false,
    text: '3 / 3 test cases passed with evidence',
    source: 'preview · 4f2a9c1',
  },
]

const LOGOS = [
  { name: 'GitHub', Icon: GitHubIcon },
  { name: 'Claude', Icon: ClaudeIcon },
  { name: 'Slack', Icon: SlackIcon },
  { name: 'Notion', Icon: NotionIcon },
  { name: 'Figma', Icon: FigmaIcon },
  { name: 'Drive', Icon: DriveIcon },
]

function Logos() {
  return (
    <section className={styles.logos}>
      <div className={styles.logosKicker}>
        PLUGS INTO THE STACK YOUR AGENTS ALREADY USE
      </div>
      <div className={styles.logosRow}>
        {LOGOS.map(({ name, Icon }) => (
          <div key={name} className={styles.logo}>
            <Icon style={{ flex: 'none' }} />
            <span className={styles.logoName}>{name}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

// The four numbers describe the READER's situation, not Lumo's techniques —
// this band sits directly under the hero, so it has to carry the h1's tension
// rather than defend our method (the method figures live on the cards they
// belong to: 31.8% on the Lineage card, 65%->19% on Guardrails, 39% on
// Context). None of these are Lumo's own results; each carries a <Cite> into
// the References band, and each `source` states the denominator so the figure
// can't be read as something stronger than what was measured.
const STAT_BAND = [
  {
    value: '441%',
    label: 'longer a pull request now sits in review',
    cite: 2,
    source:
      'industry telemetry — change in median time in PR review after AI coding adoption, across 4,000 teams and 22,000 developers (Faros AI, 2026).',
  },
  {
    value: '48%',
    label: 'of developers always check AI code before committing',
    cite: 3,
    source:
      'developer survey — while 96% say they do not fully trust that AI-generated code is functionally correct (Sonar, 2026; n=1,100+).',
  },
  {
    value: '75.8%',
    label: 'of failing agent runs claimed success anyway',
    cite: 4,
    source:
      'research finding — 1,425 of 1,879 failing coding-agent trajectories on AppWorld that made an explicit completion claim (Advani, ICML 2026 workshop).',
  },
  {
    value: '45%',
    label: 'of AI-generated code shipped a security flaw',
    cite: 5,
    source:
      'vendor research — 80 coding tasks across 100+ models; Java failed 72% of them (Veracode, 2025).',
  },
]

function StatBand() {
  return (
    <section className={styles.statBand}>
      <div className={styles.statBandInner}>
        <div className={styles.statBandHead}>
          <div className={styles.eyebrow}>The data on shipping with agents</div>
          <p className={styles.statBandNote}>
            Lumo&apos;s whole pitch is that a claim without evidence
            doesn&apos;t count — ours included. So none of these are Lumo&apos;s
            numbers: they are published research and industry telemetry, each
            one cited.{' '}
            <a href='#references' className={styles.statBandLink}>
              See the studies
            </a>
            .
          </p>
        </div>
        <div className={styles.statRow}>
          {STAT_BAND.map(({ value, label, cite, source }) => (
            <div key={label} className={styles.statItem}>
              <div className={styles.statBig}>{value}</div>
              <div className={styles.statItemLabel}>{label}</div>
              <div className={styles.statSource}>
                {source}
                <Cite n={cite} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// Three of the eight findings the 08 panel reports, one per layer that has
// something worth showing; the tail line carries the rest so the counts add up.
// Grounded in what the scanner actually emits: `secret:stripe-key` is a real
// pattern id with a HIGH severity in lib/security-scan/secret-patterns.ts, and
// `lumo.llm.untrusted-input-in-ai-sdk-prompt` is one of our own semgrep rules
// (security/semgrep-rules/llm.yaml), whose security-severity 5.0 maps to
// MEDIUM per lib/security-scan/sarif.ts. The Dependencies finding is
// deliberately unnamed — a marketing page should not publish a named package
// as vulnerable — so it states the shape, not a vendor.
// The 04 panel shows ONE test case in full rather than three titles, because
// the point of the card is what a Lumo test case actually is. The shape is the
// real TestCase model (LUM-801): setup, ordered `steps`, an optional ordered
// `verification` phase (TestCasePhase.VERIFICATION), and `expected`. The run
// underneath is a TestCaseRun: a result, the TestEnvironment, the commit it ran
// against, and an `evidence` array whose file entries are the screenshots
// uploaded through app/api/tasks/[id]/test-cases/[caseRef]/evidence.
const TEST_CASE = {
  ref: 'LUM-204/TC1',
  title: 'Card payment succeeds end-to-end',
  setup: 'Stripe test mode; cart seeded with 2 items',
  steps: [
    'Open /checkout',
    'Pay with card 4242 4242 4242 4242',
    'Submit the order',
  ],
  verification: ['Receipt row appears in the email log'],
  expected: 'Order confirmed and the receipt is queued within 30s',
  shots: 2,
}

const SCAN_FINDINGS = [
  {
    sev: 'HIGH',
    what: 'Stripe live key committed in payments.test.ts',
    meta: 'Secrets · secret:stripe-key · value redacted',
  },
  {
    sev: 'MED',
    what: 'Request body flows straight into an AI prompt',
    meta: 'Code scan · untrusted-input-in-ai-sdk-prompt',
  },
  {
    sev: 'HIGH',
    what: 'PR description reaches the planner prompt unescaped',
    meta: 'Exploit paths · reproduced in 4 steps',
  },
]

const CONTEXT_SOURCES = [
  { Icon: SlackIcon, name: 'Slack thread', meta: '#checkout-team' },
  { Icon: SpecIcon, name: 'Spec', meta: 'checkout-revamp' },
  { Icon: DocumentIcon, name: 'Document', meta: 'QA-notes.md' },
  { Icon: GlobeIcon, name: 'Web link', meta: 'stripe.com/docs' },
  { Icon: FigmaIcon, name: 'Figma file', meta: 'Checkout v3' },
  { Icon: PullRequestIcon, name: 'Pull request', meta: '#482' },
]

function Features() {
  return (
    <section id='features' className={styles.sectionAlt}>
      <div className={styles.sectionInner}>
        <div className={styles.sectionHeadLeft}>
          <div className={styles.eyebrow}>No black boxes</div>
          <h2 className={styles.h2}>
            Everything your agents can&apos;t tell you themselves.
          </h2>
        </div>

        <div className={styles.bento}>
          {/* 01 · Token & cost metering */}
          <div className={`${styles.cell} ${styles.span4} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>01 · METERING</div>
              <h3 className={styles.cellTitle}>
                You don&apos;t know what last week cost.
              </h3>
              <p className={styles.cellBody}>
                Every agent run is metered to the token — broken out by model
                and token type. See live spend per task, per agent, and per
                sprint.
              </p>
            </div>
            <div className={styles.panel}>
              <div className={styles.panelHead}>
                <span className={styles.panelLabel}>
                  build-agent · run #4821
                </span>
                <span className={styles.meterAmount}>$3.41</span>
              </div>
              <div className={styles.meterRow}>
                <div className={styles.meterRowHead}>
                  <span className={styles.meterName}>claude-sonnet-4.5</span>
                  <span className={styles.meterTok}>1.7M tok</span>
                </div>
                <div className={styles.stack}>
                  <div style={{ width: '24%', background: '#be5a38' }} />
                  <div style={{ width: '14%', background: '#d8b79f' }} />
                  <div style={{ width: '62%', background: '#e8d9c7' }} />
                </div>
              </div>
              <div className={styles.meterRowWide}>
                <div className={styles.meterRowHead}>
                  <span className={styles.meterName}>claude-haiku-4</span>
                  <span className={styles.meterTok}>0.98M tok</span>
                </div>
                <div className={styles.stack}>
                  <div style={{ width: '52%', background: '#be5a38' }} />
                  <div style={{ width: '30%', background: '#d8b79f' }} />
                  <div style={{ width: '18%', background: '#e8d9c7' }} />
                </div>
              </div>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span
                    className={styles.swatch}
                    style={{ background: '#be5a38' }}
                  />
                  Input
                </span>
                <span className={styles.legendItem}>
                  <span
                    className={styles.swatch}
                    style={{ background: '#d8b79f' }}
                  />
                  Output
                </span>
                <span className={styles.legendItem}>
                  <span
                    className={styles.swatch}
                    style={{ background: '#e8d9c7' }}
                  />
                  Cache read
                </span>
              </div>
            </div>
          </div>

          {/* 02 · Time on task */}
          <div className={`${styles.cell} ${styles.span2} ${styles.cellCol}`}>
            <div>
              <div className={styles.cellKicker}>02 · RUNTIME</div>
              <h3 className={styles.cellTitle}>
                Some run has been stuck for two hours.
              </h3>
              <p className={styles.cellBody}>
                Know which work is fast, which is stuck, and which to re-route.
              </p>
            </div>
            <div className={styles.cellStat}>
              <span className={styles.cellStatNum}>2h 14m</span>
              <span className={styles.cellStatSub}>avg · 12 runs</span>
            </div>
          </div>

          {/* 03 · Boundary guardrails */}
          <div className={`${styles.cell} ${styles.span6} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>03 · GUARDRAILS</div>
              <h3 className={styles.cellTitle}>
                It deleted the test so the feature would pass.
              </h3>
              <p className={styles.cellBody}>
                Left unguarded, agents take harmful out-of-scope actions in most
                red-team trials; pairing rules with an explicit rationale cuts
                that to roughly a third —{' '}
                <span className={styles.stat}>65%</span> →{' '}
                <span className={styles.stat}>19%</span>.<Cite n={6} /> Lumo
                classifies every crossing across{' '}
                <span className={styles.stat}>9</span> categories by type and
                severity, gates CI on catching every one, and stops the
                irreversible ones before they merge — modeled on the
                collateral-damage
                <Cite n={7} /> and minefield
                <Cite n={8} /> checks from agent-safety benchmarks.
              </p>
            </div>
            <div className={styles.crossList}>
              <div className={styles.crossRow}>
                <span className={`${styles.sev} ${styles.sevHigh}`}>HIGH</span>
                <div className={styles.crossText}>
                  <div className={styles.crossWhat}>
                    Committed with --no-verify to skip the hooks
                  </div>
                  <div className={styles.crossMeta}>
                    Hook bypass · recorded &amp; sent back
                  </div>
                </div>
              </div>
              <div className={styles.crossRow}>
                <span className={`${styles.sev} ${styles.sevHigh}`}>HIGH</span>
                <div className={styles.crossText}>
                  <div className={styles.crossWhat}>
                    Pasted a live AWS key into config.ts
                  </div>
                  <div className={styles.crossMeta}>
                    Hardcoded secret · blocked
                  </div>
                </div>
              </div>
              <div className={styles.crossRow}>
                <span className={`${styles.sev} ${styles.sevMed}`}>MED</span>
                <div className={styles.crossText}>
                  <div className={styles.crossWhat}>
                    Tried to force-push straight to main
                  </div>
                  <div className={styles.crossMeta}>
                    Protected-branch push · held for review
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* 04 · PR security scan */}
          <div className={`${styles.cell} ${styles.span6} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>04 · SECURITY</div>
              <h3 className={styles.cellTitle}>
                It shipped a vulnerability with the feature.
              </h3>
              <p className={styles.cellBody}>
                Every pull request runs five layers before it merges — secrets,
                code scan, dependencies, AI review, and an agent that hunts for
                a working exploit path. Every finding lands on the PR with a
                severity and a fingerprint, and Lumo reports what it established
                — never that you are safe.
              </p>
            </div>
            <div className={styles.panel}>
              <div className={styles.acPanelHead}>
                <span className={styles.panelLabel}>
                  SECURITY SCAN &middot; PR #482
                </span>
                <span className={styles.scanCount}>8 findings</span>
              </div>
              <div className={styles.crossList}>
                {SCAN_FINDINGS.map(({ sev, what, meta }) => (
                  <div key={what} className={styles.crossRow}>
                    <span
                      className={`${styles.sev} ${
                        sev === 'HIGH' ? styles.sevHigh : styles.sevMed
                      }`}
                    >
                      {sev}
                    </span>
                    <div className={styles.crossText}>
                      <div className={styles.crossWhat}>{what}</div>
                      <div className={styles.crossMeta}>{meta}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.scanMore}>
                +5 more across Dependencies and AI review
              </div>
            </div>
          </div>

          {/* 05 · Verifiable acceptance */}
          <div className={`${styles.cell} ${styles.span6} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>05 · VERIFICATION</div>
              <h3 className={styles.cellTitle}>
                Nobody marks their own homework.
              </h3>
              <p className={styles.cellBody}>
                Write the test cases once — setup, steps, expected result. Every
                run is appended with its verdict, the environment it ran in, the
                commit it ran against, and screenshots as evidence. The log is
                append-only: a wrong verdict is corrected by adding a row, never
                by editing one.
                <Cite n={9} />
              </p>
            </div>
            <div className={styles.panel}>
              <div className={styles.acPanelHead}>
                <span className={styles.panelLabel}>
                  TEST RUN &middot; {TEST_CASE.ref} &middot; PREVIEW
                </span>
                <span className={styles.runVerdict}>PASS</span>
              </div>
              <div className={styles.tcTitle}>{TEST_CASE.title}</div>
              <div className={styles.tcRow}>
                <span className={styles.tcLabel}>SETUP</span>
                <div className={styles.tcBody}>{TEST_CASE.setup}</div>
              </div>
              <div className={styles.tcRow}>
                <span className={styles.tcLabel}>STEPS</span>
                <div className={styles.tcBody}>
                  {TEST_CASE.steps.map((step, i) => (
                    <div key={step} className={styles.tcStep}>
                      <span className={styles.tcNum}>{i + 1}</span>
                      {step}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.tcRow}>
                <span className={styles.tcLabel}>VERIFY</span>
                <div className={styles.tcBody}>
                  {TEST_CASE.verification.map((check, i) => (
                    <div key={check} className={styles.tcStep}>
                      <span className={styles.tcNum}>{i + 1}</span>
                      {check}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.tcRow}>
                <span className={styles.tcLabel}>EXPECT</span>
                <div className={styles.tcBody}>{TEST_CASE.expected}</div>
              </div>
              <div className={styles.shotGrid}>
                <figure className={styles.shot}>
                  <div className={styles.shotBar}>
                    <span className={styles.shotDot} />
                    <span className={styles.shotDot} />
                    <span className={styles.shotDot} />
                    <span className={styles.shotUrl}>/checkout</span>
                  </div>
                  <div className={styles.shotBody}>
                    <div className={styles.shotLine} />
                    <div
                      className={`${styles.shotLine} ${styles.shotLineShort}`}
                    />
                    <div className={styles.shotField}>4242 4242 4242 4242</div>
                    <div className={styles.shotBtn}>Pay $48.00</div>
                  </div>
                  <figcaption className={styles.shotCap}>
                    step-2.png &middot; 214 KB
                  </figcaption>
                </figure>
                <figure className={styles.shot}>
                  <div className={styles.shotBar}>
                    <span className={styles.shotDot} />
                    <span className={styles.shotDot} />
                    <span className={styles.shotDot} />
                    <span className={styles.shotUrl}>/orders/8841</span>
                  </div>
                  <div className={styles.shotBody}>
                    <div className={styles.shotOkRow}>
                      <span className={styles.shotOk}>✓</span>
                      <span className={styles.shotOkText}>Order confirmed</span>
                    </div>
                    <div className={styles.shotLine} />
                    <div
                      className={`${styles.shotLine} ${styles.shotLineShort}`}
                    />
                    <div className={styles.shotField}>Receipt queued · 12s</div>
                  </div>
                  <figcaption className={styles.shotCap}>
                    verify-1.png &middot; 186 KB
                  </figcaption>
                </figure>
              </div>
              <div className={styles.scanMore}>
                commit 4f2a9c1 &middot; clean tree &middot; TC2&ndash;TC3 also
                PASS
              </div>
            </div>
          </div>

          {/* 06 · Context engineering */}
          <div className={`${styles.cell} ${styles.span6} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>06 · CONTEXT</div>
              <h3 className={styles.cellTitle}>
                It forgot what you told it on Tuesday.
              </h3>
              <p className={styles.cellBody}>
                In published trials, structured context-trimming cut filler ~
                <span className={styles.stat}>39%</span> while <em>raising</em>{' '}
                task quality <span className={styles.stat}>+2.8%</span>.
                <Cite n={10} /> Lumo assembles each run from the sources that
                matter — Slack, specs, docs, Figma, PRs — and trims the rest.
              </p>
            </div>
            <div className={styles.panel}>
              <div className={`${styles.panelHead} ${styles.panelHeadCenter}`}>
                <span className={styles.panelLabel}>CONTEXT · run #4821</span>
                <span className={styles.acCount}>6 sources</span>
              </div>
              <div className={styles.srcGrid}>
                {CONTEXT_SOURCES.map(({ Icon, name, meta }) => (
                  <div key={name} className={styles.src}>
                    <Icon size={13} style={{ flex: 'none' }} />
                    <span className={styles.srcName}>{name}</span>
                    <span className={styles.srcMeta}>{meta}</span>
                  </div>
                ))}
              </div>
              <div className={styles.srcFooter}>
                Assembled &amp; trimmed to <strong>71K tokens</strong>
              </div>
            </div>
          </div>

          {/* 07 · Lineage & memory */}
          <div className={`${styles.cell} ${styles.span3}`}>
            <div className={styles.cellKicker}>07 · LINEAGE</div>
            <h3 className={styles.cellTitle}>
              “Why is this line here?” Nobody knows.
            </h3>
            <p className={styles.cellBody} style={{ marginBottom: 22 }}>
              Evidence pays twice: every recorded run joins the record your
              agents draw on next time — a reuse that cut agent cost a mean{' '}
              <span className={styles.stat}>31.8%</span> in published trials.
              <Cite n={1} /> Lumo links every decision, source, and run so you
              can trace why.
            </p>
            <div className={styles.lineage}>
              <div className={styles.lineageRail} />
              <div className={styles.lineageT1} />
              <div className={styles.lineageT2} />
              <div className={styles.lineageNodes}>
                <span className={`${styles.node} ${styles.nodeOn}`} />
                <span className={`${styles.node} ${styles.nodeOff}`} />
                <span className={`${styles.node} ${styles.nodeOff}`} />
                <span className={`${styles.node} ${styles.nodeOn}`} />
              </div>
              <span
                className={styles.lineageLabel}
                style={{ left: '13%', top: 0 }}
              >
                source.md
              </span>
              <span
                className={styles.lineageLabel}
                style={{ left: '48%', top: 68 }}
              >
                run #4810
              </span>
            </div>
          </div>

          {/* 08 · Sprints & milestones */}
          <div className={`${styles.cell} ${styles.span3}`}>
            <div className={styles.cellKicker}>08 · PLANNING</div>
            <h3 className={styles.cellTitle}>Sprints &amp; milestones</h3>
            <p className={styles.cellBody} style={{ marginBottom: 22 }}>
              Roll work into sprints with burn-up, risk, and AI-written
              summaries — the planning layer your humans already know.
            </p>
            <div className={styles.kanban}>
              <div className={styles.kcol}>
                <div className={styles.kcolLabel}>TODO</div>
                <div
                  className={styles.kcard}
                  style={{ background: '#ece6d9' }}
                />
                <div
                  className={styles.kcard}
                  style={{ background: '#ece6d9' }}
                />
              </div>
              <div className={styles.kcol}>
                <div className={styles.kcolLabel}>DOING</div>
                <div
                  className={styles.kcard}
                  style={{ background: '#e8d5c7' }}
                />
                <div
                  className={styles.kcard}
                  style={{ background: '#ece6d9' }}
                />
              </div>
              <div className={styles.kcol}>
                <div className={`${styles.kcolLabel} ${styles.kcolLabelDone}`}>
                  DONE
                </div>
                <div
                  className={styles.kcard}
                  style={{ background: '#cfe4d4' }}
                />
                <div
                  className={styles.kcard}
                  style={{ background: '#cfe4d4' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function FinalCta() {
  return (
    <section className={styles.sectionPlain}>
      <div className={styles.ctaInner}>
        <h2 className={styles.ctaTitle}>Put your agents on the record.</h2>
        <p className={styles.ctaLede}>
          Run every test case, scan every pull request — and meter every token
          along the way. Free for your first five seats.
        </p>
        <Link
          href='/signup'
          className={`${styles.btnPrimary} ${styles.ctaBtn}`}
        >
          Start for free
        </Link>
      </div>
    </section>
  )
}

// Sources for every quantified claim on the page, numbered in the order the
// page cites them (hero -> stat band -> feature cards). Two kinds live here:
// industry telemetry / surveys about what happens to teams shipping with
// agents, and published research on the techniques Lumo builds on. Neither is
// a Lumo benchmark, which the note under the list says outright.
const REFERENCES = [
  {
    n: 1,
    text: 'Guo et al., experience-injection + early-stopping on SWE-bench Verified (ACL 2026 Findings).',
    arxiv: '2601.05777',
  },
  {
    n: 2,
    text: 'Faros AI — AI Engineering Report 2026: telemetry from 22,000 developers across 4,000 teams.',
    url: 'https://www.faros.ai/blog/ai-code-quality-senior-engineer-review-burden',
    urlLabel: 'faros.ai',
  },
  {
    n: 3,
    text: 'Sonar — State of Code Developer Survey 2026, 1,100+ developers surveyed globally.',
    url: 'https://www.sonarsource.com/company/press-releases/sonar-data-reveals-critical-verification-gap-in-ai-coding/',
    urlLabel: 'sonarsource.com',
  },
  {
    n: 4,
    text: 'Advani, “From Confident Closing to Silent Failure: Characterizing False Success in LLM Agents” (FAGEN @ ICML 2026).',
    arxiv: '2606.09863',
  },
  {
    n: 5,
    text: 'Veracode — 2025 GenAI Code Security Report: 80 curated coding tasks across 100+ models.',
    url: 'https://www.veracode.com/resources/analyst-reports/2025-genai-code-security-report/',
    urlLabel: 'veracode.com',
  },
  {
    n: 6,
    text: 'Anthropic — Model Spec Midtraining: pairing rules with an explicit rationale reduces agentic misalignment (2026).',
  },
  {
    n: 7,
    text: 'AppWorld — collateral-damage checks for agent actions.',
    arxiv: '2407.18901',
  },
  {
    n: 8,
    text: 'ToolSandbox — stateful “minefield” evaluation of tool use.',
    arxiv: '2408.04682',
  },
  {
    n: 9,
    text: 'LLM-judge reliability under cross-run agreement (pass^k discipline).',
    arxiv: '2603.02473',
  },
  {
    n: 10,
    text: 'SkillReducer — taxonomy-driven context compression across 55k skills.',
    arxiv: '2603.29919',
  },
]

function References() {
  return (
    <section id='references' className={styles.references}>
      <div className={styles.referencesInner}>
        <div className={styles.referencesLabel}>REFERENCES</div>
        <ol className={styles.referencesList}>
          {REFERENCES.map(({ n, text, arxiv, url, urlLabel }) => (
            <li key={n} className={styles.referenceItem}>
              <span className={styles.referenceNum}>{n}</span>
              <span>
                {text}
                {arxiv && (
                  <>
                    {' '}
                    <a
                      href={`https://arxiv.org/abs/${arxiv}`}
                      target='_blank'
                      rel='noopener noreferrer'
                      className={styles.referenceLink}
                    >
                      arXiv:{arxiv}
                    </a>
                  </>
                )}
                {url && (
                  <>
                    {' '}
                    <a
                      href={url}
                      target='_blank'
                      rel='noopener noreferrer'
                      className={styles.referenceLink}
                    >
                      {urlLabel ?? url}
                    </a>
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
        <p className={styles.referencesNote}>
          Lumo&apos;s design draws on 50+ papers and reports; the ones behind
          the figures on this page are listed above. None of these figures are
          Lumo&apos;s own benchmark results.
        </p>
      </div>
    </section>
  )
}

const FOOTER_COLS = [
  {
    label: 'PRODUCT',
    links: ['Features', 'Pricing', 'Changelog', 'Integrations'],
  },
  { label: 'COMPANY', links: ['About', 'Blog', 'Careers'] },
  { label: 'RESOURCES', links: ['Docs', 'API', 'Security'] },
  { label: 'COMMUNITY', links: ['Discord'] },
]

// Footer links that have a real page; the rest are still placeholders.
const FOOTER_HREFS: Record<string, string> = {
  Security: '/security',
  Discord: DISCORD_URL,
}

function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <div className={styles.footerGrid}>
          <div>
            <div className={styles.footerBrand}>
              <LumoMark size={24} style={{ display: 'block', flex: 'none' }} />
              <span className={styles.brandName}>Lumo</span>
            </div>
            <p className={styles.footerTag}>Agentic Project Management.</p>
          </div>
          {FOOTER_COLS.map(col => (
            <div key={col.label}>
              <div className={styles.footerColLabel}>{col.label}</div>
              <div className={styles.footerLinks}>
                {col.links.map(link => {
                  const href = FOOTER_HREFS[link] ?? '#'
                  const external = href.startsWith('https://')
                  return (
                    <a
                      key={link}
                      href={href}
                      className={styles.footerLink}
                      {...(external
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                    >
                      {link}
                    </a>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className={styles.footerBar}>
          <span className={styles.footerCopy}>© 2026 Lumo, Inc.</span>
          <span className={styles.footerMade}>Made for AI-native teams</span>
        </div>
      </div>
    </footer>
  )
}

interface LumoHomeProps {
  className?: string
}

export function LumoHome({ className }: LumoHomeProps) {
  return (
    <main className={className ? `${styles.root} ${className}` : styles.root}>
      <Navbar />
      <div id='top' />
      <Hero />
      <Logos />
      <StatBand />
      <Features />
      <HowItWorks />
      <LumoTerminal />
      <Compare />
      <Faq />
      <FinalCta />
      <References />
      <Footer />
    </main>
  )
}
