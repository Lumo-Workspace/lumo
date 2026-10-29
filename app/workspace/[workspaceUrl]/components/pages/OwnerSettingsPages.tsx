'use client'

import { useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { DataRetentionSection } from '../settings/DataRetentionSection'
import { DoneRequirementsCard } from '../settings/DoneRequirementsCard'
import { WorkspaceExportCard } from '../settings/WorkspaceExportCard'
import { AiDerivedContentRow } from '../settings/AiDerivedContentRow'
import { AiDerivedContentDeleteRow } from '../settings/AiDerivedContentDeleteRow'
import { AiFeaturesSection } from '../settings/AiFeaturesSection'
import { DangerZoneCard } from '../settings/DangerZoneCard'
import { SettingsSection } from '../settings/SettingsSection'
import {
  SettingsPageLayout,
  SettingsPageSkeleton,
} from '../settings/SettingsPageLayout'
import { useOwnerWorkspace } from '../../hooks/useOwnerWorkspace'
import { PluginSlot, hasPluginSlot } from '@/lib/plugins/client'

/**
 * LUM-1339 — the OWNER-only settings pages that used to be groups on the one
 * Workspace page (LUM-1327). Each composes existing cards; the shared load
 * and the non-owner redirect come from useOwnerWorkspace.
 */

/** Workflow → Done requirements (LUM-1334). */
export function DoneRequirementsSettingsPage() {
  const intl = useIntl()
  const { workspace, loading, loaded } = useOwnerWorkspace()
  if (loading) return <SettingsPageSkeleton />
  return (
    <SettingsPageLayout
      title={intl.formatMessage({
        id: 'workspaceSettings.section.doneRequirements',
      })}
    >
      {loaded && workspace && (
        <DoneRequirementsCard
          key={`done-requirements:${workspace.id}`}
          testCase={workspace.doneRequiresTestCase ?? null}
          review={workspace.doneRequiresReview ?? null}
        />
      )}
    </SettingsPageLayout>
  )
}

const CODE_REVIEW_TITLE = {
  'settings.codeReview.behavior': 'settings.codeReview.behavior',
  'settings.codeReview.repositories': 'settings.codeReview.repositories',
  'settings.codeReview.rules': 'settings.codeReview.rules',
} as const

export type CodeReviewSlot = keyof typeof CODE_REVIEW_TITLE

/**
 * Code review → one of its pages, filled by the security plugin. Without the
 * plugin (an open-source build) there is nothing to set: back to General.
 */
export function CodeReviewSettingsPage({ slot }: { slot: CodeReviewSlot }) {
  const intl = useIntl()
  const router = useRouter()
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const { workspace, me, loading, loaded } = useOwnerWorkspace()
  const available = hasPluginSlot(slot)

  useEffect(() => {
    if (!available)
      router.replace(`/workspace/${workspaceUrl}/settings/general`)
  }, [available])

  if (loading || !available) return <SettingsPageSkeleton />
  return (
    <SettingsPageLayout
      title={intl.formatMessage({ id: CODE_REVIEW_TITLE[slot] })}
    >
      {loaded && workspace && (
        <div className='flex flex-col gap-8'>
          {slot === 'settings.codeReview.behavior' ? (
            <PluginSlot
              key={workspace.id}
              name={slot}
              props={{ workspace, me }}
            />
          ) : (
            <PluginSlot key={workspace.id} name={slot} props={{}} />
          )}
        </div>
      )}
    </SettingsPageLayout>
  )
}

/** Data & security → Data retention (LUM-933). */
export function DataRetentionSettingsPage() {
  const intl = useIntl()
  const { workspace, loading, loaded } = useOwnerWorkspace()
  if (loading) return <SettingsPageSkeleton />
  const title = intl.formatMessage({ id: 'dataRetention.title' })
  return (
    <SettingsPageLayout
      title={title}
      subtitle={intl.formatMessage({ id: 'dataRetention.description' })}
    >
      {loaded && workspace && (
        <DataRetentionSection
          key={`retention:${workspace.id}`}
          label={title}
          settings={{
            hookEventRetentionMode: workspace.hookEventRetentionMode ?? null,
            hookEventRetentionDays: workspace.hookEventRetentionDays ?? null,
            crossingRawRetentionDays:
              workspace.crossingRawRetentionDays ?? null,
            deadLetterRetentionDays: workspace.deadLetterRetentionDays ?? null,
          }}
          workspace={workspace}
        />
      )}
    </SettingsPageLayout>
  )
}

/**
 * Data & security → AI: the feature switches (LUM-1338), whether AI-generated
 * content is kept (LUM-917) and its delete — the switch and the delete of the
 * same content on one page.
 */
export function AiSettingsPage() {
  const intl = useIntl()
  const { workspace, loading, loaded } = useOwnerWorkspace()
  if (loading) return <SettingsPageSkeleton />
  return (
    <SettingsPageLayout
      title={intl.formatMessage({ id: 'settings.ai' })}
      subtitle={intl.formatMessage({ id: 'settings.ai.subtitle' })}
    >
      {loaded && workspace && (
        <>
          <SettingsSection
            id='ai-features'
            title={intl.formatMessage({
              id: 'workspaceSettings.section.aiFeatures',
            })}
          >
            <AiFeaturesSection />
          </SettingsSection>
          <SettingsSection
            id='ai-derived-content'
            title={intl.formatMessage({ id: 'settings.ai.derivedContent' })}
          >
            <div className='rounded-lg border border-border overflow-hidden'>
              <AiDerivedContentRow
                key={`ai-derived:${workspace.id}`}
                initialEnabled={workspace.aiDerivedContentEnabled ?? null}
              />
            </div>
          </SettingsSection>
          <SettingsSection id='danger-zone'>
            <DangerZoneCard>
              <AiDerivedContentDeleteRow workspaceName={workspace.name} />
            </DangerZoneCard>
          </SettingsSection>
        </>
      )}
    </SettingsPageLayout>
  )
}

/** Data & security → Export (GDPR data export, LUM-858). */
export function ExportSettingsPage() {
  const intl = useIntl()
  const { workspace, loading, loaded } = useOwnerWorkspace()
  if (loading) return <SettingsPageSkeleton />
  return (
    <SettingsPageLayout title={intl.formatMessage({ id: 'settings.export' })}>
      {loaded && workspace && (
        <WorkspaceExportCard key={`export:${workspace.id}`} />
      )}
    </SettingsPageLayout>
  )
}
