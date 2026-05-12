const GH_API = 'https://api.github.com'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }
}

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

interface FileCommit {
  path: string
  content: string
}

interface CreateBranchCommitResult {
  branchName: string
  commitSha: string
}

export const githubTreeService = {
  async readFile(
    owner: string,
    repo: string,
    path: string,
    token: string
  ): Promise<string | null> {
    const res = await fetch(
      `${GH_API}/repos/${owner}/${repo}/contents/${path}`,
      { headers: ghHeaders(token) }
    )
    if (!res.ok) {
      if (res.status === 404) return null
      const err = await res.json().catch(() => ({}))
      httpError(
        502,
        `GitHub readFile failed: ${(err as { message?: string }).message ?? res.status}`
      )
    }
    const data = (await res.json()) as { content: string }
    return Buffer.from(data.content, 'base64').toString('utf-8')
  },

  async createBranchWithFiles(
    owner: string,
    repo: string,
    baseBranch: string,
    branchName: string,
    files: FileCommit[],
    commitMessage: string,
    token: string
  ): Promise<CreateBranchCommitResult> {
    const headers = ghHeaders(token)
    const base = `${GH_API}/repos/${owner}/${repo}`

    // 1. Get base branch ref → commit SHA
    const refRes = await fetch(`${base}/git/ref/heads/${baseBranch}`, {
      headers,
    })
    if (!refRes.ok) httpError(502, 'Failed to get base branch ref')
    const refData = (await refRes.json()) as { object: { sha: string } }
    const baseSha = refData.object.sha

    // 2. Get base commit → tree SHA
    const commitRes = await fetch(`${base}/git/commits/${baseSha}`, { headers })
    if (!commitRes.ok) httpError(502, 'Failed to get base commit')
    const commitData = (await commitRes.json()) as { tree: { sha: string } }
    const baseTreeSha = commitData.tree.sha

    // 3. Create blobs for each file
    const treeItems: {
      path: string
      mode: string
      type: string
      sha: string
    }[] = []
    for (const file of files) {
      const blobRes = await fetch(`${base}/git/blobs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
      })
      if (!blobRes.ok) httpError(502, `Failed to create blob for ${file.path}`)
      const blobData = (await blobRes.json()) as { sha: string }
      treeItems.push({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobData.sha,
      })
    }

    // 4. Create tree
    const treeRes = await fetch(`${base}/git/trees`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    })
    if (!treeRes.ok) httpError(502, 'Failed to create tree')
    const treeData = (await treeRes.json()) as { sha: string }

    // 5. Create commit
    const newCommitRes = await fetch(`${base}/git/commits`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: [baseSha],
      }),
    })
    if (!newCommitRes.ok) httpError(502, 'Failed to create commit')
    const newCommitData = (await newCommitRes.json()) as { sha: string }

    // 6. Create branch ref
    const createRefRes = await fetch(`${base}/git/refs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: newCommitData.sha,
      }),
    })
    if (!createRefRes.ok) httpError(502, 'Failed to create branch')

    return { branchName, commitSha: newCommitData.sha }
  },

  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    body: string,
    head: string,
    base: string,
    token: string
  ): Promise<{ prUrl: string; prNumber: number }> {
    const res = await fetch(`${GH_API}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: ghHeaders(token),
      body: JSON.stringify({ title, body, head, base }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      httpError(
        502,
        `Failed to create PR: ${(err as { message?: string }).message ?? res.status}`
      )
    }
    const data = (await res.json()) as { html_url: string; number: number }
    return { prUrl: data.html_url, prNumber: data.number }
  },
}
