const GH_API = 'https://api.github.com'
const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
}

/**
 * Creates a webhook on a GitHub repo listening for pull_request,
 * pull_request_review, and check_suite events.
 *
 * @returns The GitHub webhook ID (needed to delete later).
 * @throws  If the API call fails.
 */
export async function createRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  webhookUrl: string,
  secret: string
): Promise<number> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/hooks`, {
    method: 'POST',
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'web',
      active: true,
      events: ['pull_request', 'pull_request_review', 'check_suite'],
      config: {
        url: webhookUrl,
        content_type: 'json',
        secret,
        insecure_ssl: '0',
      },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GitHub createRepoWebhook failed ${res.status}: ${body}`)
  }
  const data = await res.json()
  return data.id as number
}

/**
 * Deletes a webhook from a GitHub repo.
 * Silently succeeds if the webhook is already gone (404).
 */
export async function deleteRepoWebhook(
  token: string,
  owner: string,
  repo: string,
  hookId: number
): Promise<void> {
  const res = await fetch(`${GH_API}/repos/${owner}/${repo}/hooks/${hookId}`, {
    method: 'DELETE',
    headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
  })
  if (!res.ok && res.status !== 404) {
    const body = await res.text()
    console.error(
      `[github] deleteRepoWebhook ${owner}/${repo}#${hookId} failed ${res.status}: ${body}`
    )
  }
}
