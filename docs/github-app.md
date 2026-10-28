# GitHub App permissions

> This section documents the hosted service's App, which also carries the
> security plugin's permissions. To register an App for a self-hosted
> deployment, follow
> [docs/self-hosting/integrations.md](self-hosting/integrations.md):
> it is the source for the core's minimum permissions, events and URLs.

A workspace connects GitHub over **two grants with different jobs**, both
shown as their own row in workspace → settings → integrations:

| Grant                               | Identity                    | Does                                                                                                                                     |
| ----------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **App installation** (team)         | the Lumo App, per workspace | everything that touches a repository: repo list, PR links, webhooks, comment mirroring, the managed security scan's clone                |
| **OAuth link** (personal, optional) | the member who linked it    | identity only — records which GitHub login is this member, so comments arriving from GitHub are attributed to them in Lumo (`read:user`) |

Nothing runs on a member's token. Every mirrored comment is posted by the App
with an attribution line linking back to the Lumo comment; the App cannot
speak as a person, and that link is what preserves "who said this". The
repository set is chosen in GitHub's install settings, not in Lumo. **A
workspace without the App installed is not scanned** — the card says so.

The Lumo GitHub App (`GITHUB_APP_ID` / `GITHUB_APP_PRIVATE_KEY`) needs this
minimum permission set:

| Permission    | Access       | Used by                                                     |
| ------------- | ------------ | ----------------------------------------------------------- |
| Contents      | Read & write | file reads, PR diffs, scan clone; resolving review threads¹ |
| Pull requests | Read & write | PR head sha, change volume, comment mirror (LUM-546)        |
| Issues        | Read & write | comment mirror (issue comments)                             |
| Checks        | Read         | `check_suite` events → PR CI status                         |
| Metadata      | Read         | mandatory                                                   |

¹ GitHub refuses `resolveReviewThread` / `unresolveReviewThread` to a token
without `contents: write` (LUM-1127). Without it the security summary still
posts; Lumo's review threads are just never resolved.

## Installation flow

`GITHUB_APP_SLUG` names the App in its install URL, and
`GITHUB_APP_WEBHOOK_SECRET` is the secret configured on the **App's own**
webhook (a different delivery from the per-repo hooks OAuth creates — both
arrive at `/api/webhooks/github` and are verified against different secrets).
`GITHUB_APP_CLIENT_ID` / `GITHUB_APP_CLIENT_SECRET` are the **App's** client
credentials (not the OAuth App's `GITHUB_CLIENT_ID`), and the App's
**Callback URL** must include `https://<your-domain>/api/github/app/callback`;
leave "Request user authorization during installation" off. Without them no
installation can be recorded (LUM-875).

1. The settings card sends the owner to `/api/github/app/install`, which
   redirects to the App's install page with an encrypted `state` naming the
   workspace.
2. GitHub returns to `/api/github/app/setup`, which re-checks that the
   signed-in caller is a member of that workspace (the state carries context,
   never authority). The `installation_id` GitHub appends is attacker-
   controllable, so setup stores nothing: it sends the caller to authorize the
   App, and `/api/github/app/callback` exchanges the code for a user token,
   checks `GET /user/installations` lists that installation, revokes the
   token, and only then reads and stores the installation (LUM-875).
3. The App webhook keeps the record current: `installation` (created /
   deleted / suspend / unsuspend / new_permissions_accepted) and
   `installation_repositories` (added / removed). A suspended or deleted
   installation drops the record — a workspace that cannot be cloned must not
   be shown as installed — and scrubs that workspace's scan code first
   (LUM-902). Newly reachable repositories get their existing pull
   requests backfilled.
4. Repository events (`pull_request`, `push`, `check_suite`, `status`,
   `issue_comment`, `pull_request_review`, `pull_request_review_comment`)
   arrive on the same App webhook and are attributed through `installation.id`.
   **Subscribe the App to all of these.** Repo hooks created by the old OAuth
   flow still deliver too; while one exists for a repository the App copy of
   that event is dropped so nothing is handled twice, and the App takes over
   on its own once the hook is removed (disconnecting the OAuth link deletes
   the hooks it created).
5. Access recheck (LUM-882). Binding and owner re-verification record the
   verifier's GitHub login (an identifier; the user token is still revoked).
   A daily cron (`/api/cron/recheck-github-access`) asks GitHub, with the
   installation token, whether that login can still read each confirmed
   repository (`collaborators/{login}/permission`, Metadata read — no extra
   App permission); repositories it cannot read are removed and their scan
   code scrubbed. **Subscribe the App to the `repository` event** too:
   `privatized` / `transferred` trigger the same check for that repository
   straight away. Installations bound before LUM-882 have no login on record
   and are not rechecked until an owner re-verifies once. When the sweep
   cannot get an installation token and GitHub answers that the installation
   is gone (404) or suspended — the `deleted` webhook was lost — every
   workspace bound to it is unbound and scrubbed (LUM-902; this check covers
   the pre-LUM-882 installations too).
6. Backstop (LUM-902). A daily cron (`/api/cron/sweep-unconfirmed-scan-code`)
   scrubs the scan code of any repository not on its workspace's confirmed
   list — or of every repository, for a workspace without the App — whatever
   best-effort path left it behind.
7. Evidence retention (LUM-911). An hourly cron
   (`/api/cron/sweep-expired-scan-evidence`) scrubs a scan's code once it is
   used up: its PR merged or closed, every scan of the PR final, and the
   workspace's retention (Settings, OWNER: 7 days by default, 14, 30, or zero)
   elapsed. A scan on a PR that stays open is scrubbed 30 days after it
   finished. Zero retention scrubs a scan as soon as it is final and its PR
   review is posted. Rows, counts and dispositions stay; scans from before
   LUM-911 are not swept.
8. PR comment sync dead letters (LUM-913). A PR comment sync job that keeps
   failing is parked as a dead letter with the GitHub webhook body it was
   handling. The daily cron `/api/cron/prune-hook-event-payloads` drops that
   body 7 days after the job dead-lettered, keeping only the operation /
   event, task, PR, error and timestamps. Dead letters from before LUM-913
   are not swept; an internal read-only count script (LUM-913) counts
   them.

**No fallback.** A workspace with no installation record gets no GitHub
token at all — every GitHub call for it fails with "install the Lumo GitHub
App". (Before LUM-852 it borrowed the global `GITHUB_APP_INSTALLATION_ID`,
Lumo's own installation; that env var is no longer read.)
