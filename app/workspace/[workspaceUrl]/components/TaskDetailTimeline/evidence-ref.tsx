'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Copy, Check } from 'lucide-react'
import { parseEvidencePointer } from '../../../../../shared/src/acceptance-evidence'

/**
 * Web drill-down for an acceptance evidence pointer (LUM-563) — the same upgrade
 * the CLI's `formatEvidenceDrilldown` makes for `lumo task status`, so the two
 * surfaces read the same: a `commit:` pointer becomes a link to the repo commit
 * (or a `git show` hint when no repo URL is derivable), a `file:` pointer a
 * `path:line` locator, a `cmd:` pointer the command + its exit with a copy
 * affordance. The pointer grammar is the shared single source of truth
 * (parseEvidencePointer); an unrecognised shape falls back to the raw token so
 * data is never hidden, only upgraded when we know how.
 */

/** Derive the repo's https web base from a synced PR url (e.g.
 *  `https://github.com/acme/repo/pull/3` → `https://github.com/acme/repo`) so a
 *  `commit:` pointer can drill to a navigable URL. Null when no PR url is
 *  available — the renderer then uses the `git show` fallback, never a broken
 *  link. The struggle trail's PR list is the same-task, same-source origin. */
export function deriveRepoWebUrl(
  pullRequests: ReadonlyArray<{ url: string }> | undefined
): string | null {
  const url = pullRequests?.find(p => p.url)?.url
  if (!url) return null
  const m =
    /^(https?:\/\/[^/]+\/[^/]+\/[^/]+)(?:\/(?:pull|issues|commit)\/.*)?$/.exec(
      url.trim()
    )
  return m ? m[1]! : null
}

function CopyButton({
  text,
  idSuffix,
  label,
}: {
  text: string
  idSuffix: string
  label: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type='button'
      data-testid={`evidence-copy-${idSuffix}`}
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 1200)
      }}
      className='shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors'
    >
      {copied ? (
        <Check className='size-3' aria-hidden />
      ) : (
        <Copy className='size-3' aria-hidden />
      )}
    </button>
  )
}

export function EvidenceRef({
  pointer,
  repoWebUrl,
  idSuffix,
}: {
  pointer: string
  repoWebUrl: string | null
  /** Stable suffix (the criterion id) so per-row copy buttons get unique ids. */
  idSuffix: string
}) {
  const intl = useIntl()
  const parsed = parseEvidencePointer(pointer)

  // Unrecognised shape — show the raw pointer rather than hide the data.
  if (!parsed) {
    return <span className='break-all'>{pointer}</span>
  }

  if (parsed.kind === 'commit') {
    const short = parsed.hash.slice(0, 10)
    const label = intl.formatMessage(
      { id: 'acceptance.evidence.commit', defaultMessage: 'commit {short}' },
      { short }
    )
    return (
      <span className='inline-flex items-center gap-1.5 break-all'>
        {repoWebUrl ? (
          <a
            href={`${repoWebUrl}/commit/${parsed.hash}`}
            target='_blank'
            rel='noopener noreferrer'
            className='text-info hover:underline'
          >
            {label}
          </a>
        ) : (
          <span>{label}</span>
        )}
        <CopyButton
          text={parsed.hash}
          idSuffix={idSuffix}
          label={intl.formatMessage({
            id: 'acceptance.evidence.copyCommit',
            defaultMessage: 'Copy commit hash',
          })}
        />
      </span>
    )
  }

  if (parsed.kind === 'file') {
    const loc = `${parsed.path}:${parsed.line}`
    return (
      <span className='inline-flex items-center gap-1.5 break-all'>
        <span>{loc}</span>
        <CopyButton
          text={loc}
          idSuffix={idSuffix}
          label={intl.formatMessage({
            id: 'acceptance.evidence.copyLocation',
            defaultMessage: 'Copy location',
          })}
        />
      </span>
    )
  }

  // cmd — the command plus its exit, re-runnable; copy the command itself.
  return (
    <span className='inline-flex items-center gap-1.5 break-all'>
      <span>
        <span className='text-muted-foreground/50'>$ </span>
        {parsed.command}
      </span>
      <span className={parsed.exitCode === 0 ? 'text-success' : 'text-danger'}>
        {parsed.exitCode === 0 ? '✓' : '✗'}{' '}
        {intl.formatMessage(
          {
            id: 'acceptance.check.exitCode',
            defaultMessage: 'exit code {code}',
          },
          { code: parsed.exitCode }
        )}
      </span>
      <CopyButton
        text={parsed.command}
        idSuffix={idSuffix}
        label={intl.formatMessage({
          id: 'acceptance.evidence.copyCommand',
          defaultMessage: 'Copy command',
        })}
      />
    </span>
  )
}
