'use client'

/**
 * LUM-1062 — client entry of the security plugin (RFC §3.2, §3.4 UI 插槽):
 * fills the core's UI slots with the existing security components. Listed
 * in `lib/plugins/installed.client.ts`; the OSS snapshot lists nothing, so
 * none of this reaches its bundle.
 */
import type { LumoClientPlugin } from '@/lib/plugins/client'
import { SecurityTaskDossier } from './ui/task-dossier'
import { SecurityPrBadge } from './ui/pr-badge-slot'
import { SecurityCrossingTriage } from './ui/crossing-triage-slot'
import {
  SecurityPolicyCoverage,
  SecurityRepoReviewSettings,
  SecurityScanEvidenceRetention,
  SecuritySettingsSection,
} from './ui/settings-slots'

export const securityClientPlugin: LumoClientPlugin = {
  id: 'security',
  slots: {
    'task.dossier': SecurityTaskDossier,
    'task.pullRequest.badge': SecurityPrBadge,
    'task.crossing.annotation': SecurityCrossingTriage,
    'settings.codeReview.behavior': SecuritySettingsSection,
    'settings.codeReview.repositories': SecurityRepoReviewSettings,
    'settings.codeReview.rules': SecurityPolicyCoverage,
    'settings.retention.row': SecurityScanEvidenceRetention,
  },
}
