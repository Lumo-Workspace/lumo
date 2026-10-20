import { apiFetch } from './base'
import type { FeedbackKindValue } from '@/lib/validation/feedback'

/** The JSON `payload` part of `POST /api/feedback` that the web form sends. */
export interface FeedbackCreateInput {
  kind: FeedbackKindValue
  title: string
  expected?: string | null | undefined
  actual?: string | null | undefined
}

/** The fields of the created report the web form uses. */
export interface CreatedFeedback {
  ref: string
}

export interface FeedbackSubmitResult {
  ref: string
  /** Screenshots that could not be attached; the report itself was saved. */
  failedFiles: File[]
}

/**
 * LUM-1287: the web side of LUM-1240's `lumo feedback`. Same routes as the
 * CLI — the server records a browser session as `submittedVia: WEB`. No
 * `environment`: its whitelist describes a CLI install, not a browser.
 */
export const feedbackClient = {
  async create(input: FeedbackCreateInput): Promise<CreatedFeedback> {
    const form = new FormData()
    form.append('payload', JSON.stringify(input))
    const res = await apiFetch<{ feedback: CreatedFeedback }>('/api/feedback', {
      method: 'POST',
      body: form,
    })
    return res.feedback
  },

  /** One file per request, so each upload stays under the platform's body limit. */
  async attachEvidence(ref: string, file: File): Promise<void> {
    const form = new FormData()
    form.append('file', file)
    await apiFetch(`/api/feedback/${encodeURIComponent(ref)}/evidence`, {
      method: 'POST',
      body: form,
    })
  },

  /**
   * Create the report, then attach each screenshot in turn. A failed upload
   * does not undo the report — it is returned in `failedFiles` instead.
   */
  async submit(
    input: FeedbackCreateInput,
    files: readonly File[]
  ): Promise<FeedbackSubmitResult> {
    const { ref } = await feedbackClient.create(input)
    const failedFiles: File[] = []
    for (const file of files) {
      try {
        await feedbackClient.attachEvidence(ref, file)
      } catch {
        failedFiles.push(file)
      }
    }
    return { ref, failedFiles }
  },
}
