import Link from 'next/link'

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
            href='#faq'
            className={`${styles.navLink} ${styles.navLinkHideSm}`}
          >
            FAQ
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
            Your agents say it&apos;s done. Lumo{' '}proves{' '}it.
          </h1>
          <p className={styles.heroLede}>
            An agent&apos;s report is testimony — a verified merge is evidence.
            Lumo freezes acceptance criteria before work starts, then checks
            every criterion against proof when your agents report done. Every
            token and hour is metered along the way.
          </p>
          <p className={styles.heroProof}>
            Verification compounds: agents that reuse what past runs proved out
            cut cost a mean <span className={styles.stat}>31.8%</span>, with
            ≤0.2% quality loss, in controlled trials.
            <Cite n={1} /> Trust is the product — the savings are its dividend.
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
              <span className={styles.badgeVerified}>VERIFIED</span>
            </div>
            <div className={styles.mockSub}>
              Agent · claude-sonnet · run #4821
            </div>

            <div className={styles.metricGrid}>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>TOKENS</div>
                <div className={styles.metricValue}>
                  847K<span> / 1M</span>
                </div>
                <div className={styles.bar}>
                  <div className={styles.barFill} style={{ width: '84%' }} />
                </div>
              </div>
              <div className={styles.metric}>
                <div className={styles.metricLabel}>TIME · COST</div>
                <div className={styles.metricValue}>2h 14m</div>
                <div className={styles.metricSub}>$3.41 spent</div>
              </div>
            </div>

            <div className={styles.acLabel}>ACCEPTANCE CRITERIA · 8/8</div>
            <div className={styles.acList}>
              {[
                {
                  text: 'Card payment succeeds end-to-end',
                  source: 'E2E test · run #4821',
                },
                {
                  text: 'Declined cards show a clear error',
                  source: 'unit test · payments.spec',
                },
                {
                  text: 'Receipts emailed within 30s',
                  source: 'log probe · run #4821',
                },
              ].map(c => (
                <div key={c.text} className={styles.acItem}>
                  <span className={styles.acCheck}>✓</span>
                  {c.text}
                  <span className={styles.acSource}>{c.source}</span>
                </div>
              ))}
            </div>
          </WindowShell>
        </div>
      </div>
    </section>
  )
}

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

// Prominent "evidence" numbers, Augment-style. The first figure is Lumo's own
// (a count of the research it draws on); the three percentages are EXTERNAL
// research effects on the techniques Lumo is built on — attributed in each
// `source` line and in the band note, never claimed as Lumo's own results.
// The 71% (65%→19%) is a *prevention* effect from the literature — kept as the
// research case for guardrails, NOT a claim that Lumo reduces harm (Lumo only
// detects; detection coverage lives on the Guardrails card).
const STAT_BAND = [
  {
    value: '50+',
    label: 'research papers & reports behind Lumo',
    source:
      'the studies Lumo’s design draws on, tracked in our research-intake ledger.',
  },
  {
    value: '40%',
    label: 'work time lost to task-switching',
    source:
      'research finding — task-switching can cost up to 40% of productive time (APA, Meyer 2001). Lumo keeps every run’s context in one place.',
  },
  {
    value: '31.8%',
    label: 'lower agent cost from verified-run reuse',
    source:
      'research finding — when agents reuse what past runs already worked out (EET, on SWE-bench). The more deliveries you verify, the more there is to reuse.',
  },
  {
    value: '71%',
    label: 'fewer misaligned agent actions',
    source:
      'research finding — when an agent’s rules carry a reason, 65% down to 19% (Anthropic Model Spec).',
  },
]

function StatBand() {
  return (
    <section className={styles.statBand}>
      <div className={styles.statBandInner}>
        <div className={styles.statBandHead}>
          <div className={styles.eyebrow}>The research behind Lumo</div>
          <p className={styles.statBandNote}>
            The percentages below are effects measured in published research on
            the techniques Lumo is built on — not Lumo&apos;s own benchmarks.{' '}
            <a href='#references' className={styles.statBandLink}>
              See the studies
            </a>
            .
          </p>
        </div>
        <div className={styles.statRow}>
          {STAT_BAND.map(({ value, label, source }) => (
            <div key={label} className={styles.statItem}>
              <div className={styles.statBig}>{value}</div>
              <div className={styles.statItemLabel}>{label}</div>
              <div className={styles.statSource}>{source}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

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
          <div className={styles.eyebrow}>Everything in one place</div>
          <h2 className={styles.h2}>
            Run AI work like a team, not a black box.
          </h2>
        </div>

        <div className={styles.bento}>
          {/* 01 · Token & cost metering */}
          <div className={`${styles.cell} ${styles.span4} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>01 · METERING</div>
              <h3 className={styles.cellTitle}>Token &amp; cost metering</h3>
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
              <h3 className={styles.cellTitle}>Time on task</h3>
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
              <h3 className={styles.cellTitle}>Boundary guardrails</h3>
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
                <Cite n={3} /> and minefield
                <Cite n={4} /> checks from agent-safety benchmarks.
              </p>
            </div>
            <div className={styles.crossList}>
              <div className={styles.crossRow}>
                <span className={`${styles.sev} ${styles.sevHigh}`}>HIGH</span>
                <div className={styles.crossText}>
                  <div className={styles.crossWhat}>
                    Rewrote a unit test so a broken feature passes
                  </div>
                  <div className={styles.crossMeta}>
                    Test tampering · reverted &amp; sent back
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

          {/* 04 · Verifiable acceptance */}
          <div className={`${styles.cell} ${styles.span6} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>04 · VERIFICATION</div>
              <h3 className={styles.cellTitle}>Verifiable acceptance</h3>
              <p className={styles.cellBody}>
                Write crisp acceptance criteria once. Agents can only mark a
                task done when every criterion provably passes — and
                non-deterministic checks report cross-run agreement, not one
                lucky pass.
                <Cite n={5} />
              </p>
            </div>
            <div className={styles.panel}>
              <div className={styles.acPanelHead}>
                <span className={styles.panelLabel}>ACCEPTANCE CRITERIA</span>
                <span className={styles.acCount}>7/8</span>
              </div>
              <div className={styles.acList}>
                <div className={styles.acItemSm}>
                  <span className={styles.acCheckSm}>✓</span>Card payment
                  succeeds end-to-end
                </div>
                <div className={styles.acItemSm}>
                  <span className={styles.acCheckSm}>✓</span>Declined cards show
                  a clear error
                </div>
                <div className={`${styles.acItemSm} ${styles.acItemSmOpen}`}>
                  <span className={styles.acOpen} />
                  Receipts emailed within 30s
                </div>
              </div>
            </div>
          </div>

          {/* 05 · Context engineering */}
          <div className={`${styles.cell} ${styles.span6} ${styles.cellSplit}`}>
            <div>
              <div className={styles.cellKicker}>05 · CONTEXT</div>
              <h3 className={styles.cellTitle}>Context engineering</h3>
              <p className={styles.cellBody}>
                In published trials, structured context-trimming cut filler ~
                <span className={styles.stat}>39%</span> while <em>raising</em>{' '}
                task quality <span className={styles.stat}>+2.8%</span>.
                <Cite n={2} /> Lumo assembles each run from the sources that
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

          {/* 06 · Lineage & memory */}
          <div className={`${styles.cell} ${styles.span3}`}>
            <div className={styles.cellKicker}>06 · LINEAGE</div>
            <h3 className={styles.cellTitle}>Lineage &amp; memory</h3>
            <p className={styles.cellBody} style={{ marginBottom: 22 }}>
              Verification pays twice: every verified run joins the record your
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

          {/* 07 · Sprints & milestones */}
          <div className={`${styles.cell} ${styles.span3}`}>
            <div className={styles.cellKicker}>07 · PLANNING</div>
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
          Freeze the spec, verify every delivery — and meter every token along
          the way. Free for your first five seats.
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

// Sources for the quantified claims above. These are effects measured in
// published research on the techniques Lumo builds on — cited so every figure
// on the page is traceable, and clearly *not* presented as Lumo's own results.
const REFERENCES = [
  {
    n: 1,
    text: 'Guo et al., experience-injection + early-stopping on SWE-bench Verified (ACL 2026 Findings).',
    arxiv: '2601.05777',
  },
  {
    n: 2,
    text: 'SkillReducer — taxonomy-driven context compression across 55k skills.',
    arxiv: '2603.29919',
  },
  {
    n: 3,
    text: 'AppWorld — collateral-damage checks for agent actions.',
    arxiv: '2407.18901',
  },
  {
    n: 4,
    text: 'ToolSandbox — stateful “minefield” evaluation of tool use.',
    arxiv: '2408.04682',
  },
  {
    n: 5,
    text: 'LLM-judge reliability under cross-run agreement (pass^k discipline).',
    arxiv: '2603.02473',
  },
  {
    n: 6,
    text: 'Anthropic — Model Spec Midtraining: pairing rules with an explicit rationale reduces agentic misalignment (2026).',
  },
]

function References() {
  return (
    <section id='references' className={styles.references}>
      <div className={styles.referencesInner}>
        <div className={styles.referencesLabel}>REFERENCES</div>
        <ol className={styles.referencesList}>
          {REFERENCES.map(({ n, text, arxiv }) => (
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
              </span>
            </li>
          ))}
        </ol>
        <p className={styles.referencesNote}>
          Figures above are effects measured in published research on the
          techniques Lumo is built on — not Lumo&apos;s own benchmark results.
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
]

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
                {col.links.map(link => (
                  <a key={link} href='#' className={styles.footerLink}>
                    {link}
                  </a>
                ))}
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
      <Faq />
      <FinalCta />
      <References />
      <Footer />
    </main>
  )
}
