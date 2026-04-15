export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
}

export async function createPullRequest({
  owner,
  repo,
  branch,
  title,
  body,
  token,
  baseBranch = 'main',
}: {
  owner: string
  repo: string
  branch: string
  title: string
  body: string
  token: string
  baseBranch?: string
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title, body, head: branch, base: baseBranch }),
    }
  )

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`Failed to create PR: ${JSON.stringify(error)}`)
  }

  return response.json()
}

export async function updateTask(
  id: string,
  data: {
    title?: string
    description?: string | null
    status?: string
    priority?: string
    assigneeActorId?: string | null
    agentStatus?: string | null
    agentError?: string | null
  }
) {
  // no-op stub — actual persistence handled by service layer
}

export async function createNotification(
  recipientId: string,
  type: string,
  taskId: string
) {
  // no-op stub — actual persistence handled by service layer
}
