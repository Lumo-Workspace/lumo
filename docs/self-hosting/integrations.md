# Integrations when self-hosting

GitHub, Slack, Figma, Google Drive and Sentry are optional. On a self-hosted
Lumo **you** register the app on each provider and give Lumo its credentials
through environment variables. An integration whose variables are incomplete
is hidden on **workspace → Settings → Integrations**, and its routes answer
404 `integration_not_configured` (`lib/integrations/configured.ts`,
`lib/api/integration-configured.ts`).

Everything below was derived from the code that calls each provider; the
source file is named next to each permission, scope and event so you can
re-check it after an upgrade. All examples use placeholders — never paste a
real client id, secret or private key into a ticket, a commit or a chat.

| Integration                                          | Scope of a connection             | Env vars (plus `ENCRYPTION_KEY`)                                                                                                              |
| ---------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [GitHub App](#github-app)                            | per workspace                     | `GITHUB_APP_SLUG`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_WEBHOOK_SECRET` |
| [GitHub account link (OAuth App)](#github-oauth-app) | per member                        | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                                                                                    |
| [Slack](#slack)                                      | per workspace                     | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`                                                                              |
| [Figma](#figma)                                      | per member                        | `FIGMA_OAUTH_CLIENT_ID`, `FIGMA_OAUTH_CLIENT_SECRET`, `FIGMA_OAUTH_REDIRECT_URI`                                                              |
| [Google Drive](#google-drive)                        | per member                        | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_DRIVE_OAUTH_REDIRECT_URI`                                                                 |
| [Sentry](#sentry)                                    | per workspace (entered in the UI) | none besides `ENCRYPTION_KEY`                                                                                                                 |

Below, `https://lumo.example.com` stands for your public URL — the value of
`NEXT_PUBLIC_APP_URL`. Most callback URLs are built from it at runtime
(`${NEXT_PUBLIC_APP_URL}/api/...`), so it must be the exact origin the
provider redirects browsers to, and it is baked into the browser bundle:
**rebuild after changing it** (`docker compose up -d --build`).

With Docker Compose, add the variables to `.env` and run
`docker compose up -d` (no rebuild needed for these server-side variables).

## Before you start

### `ENCRYPTION_KEY`

Every integration needs it. Lumo encrypts with AES-256-GCM (`lib/crypto.ts`):
the OAuth `state` parameter of every connect flow
(`lib/integrations/oauth-state.ts`), the stored Slack bot token, the GitHub
account-link token, Figma and Google Drive access/refresh tokens, and the
Sentry client secret.

```bash
openssl rand -hex 32   # 64 hex characters = 32 bytes
```

```dotenv
ENCRYPTION_KEY=<64 hex characters>
```

- It must be exactly 64 **hex** characters; anything else makes every
  encrypt/decrypt throw.
- **There is no key rotation.** Lumo keeps no key id and no old key, so
  changing `ENCRYPTION_KEY` makes every stored token undecryptable and every
  in-flight connect link invalid. If you must change it (e.g. it leaked):
  set the new key, restart, then have each workspace **disconnect and
  reconnect** Slack and re-enter the Sentry client secret, and each member
  reconnect GitHub account link, Figma and Google Drive. The GitHub App
  is not affected: its installation tokens are minted from
  `GITHUB_APP_PRIVATE_KEY` on demand and never stored.
- Back it up with the database backup — a restored database without its key
  has the same effect as a rotation.

### A public URL (webhooks and OAuth)

| Needs inbound requests from the provider's servers           | Only needs the user's browser to reach Lumo |
| ------------------------------------------------------------ | ------------------------------------------- |
| GitHub App webhook, Slack events and mentions, Sentry alerts | GitHub account link, Figma, Google Drive    |

OAuth redirects go through the user's browser, so `http://localhost:3000`
callbacks work for a single-machine test (GitHub, Figma and Google accept
localhost redirect URIs; Slack requires `https`). **Webhooks are sent by the
provider's servers**: GitHub, Slack and Sentry must be able to reach
`https://<public host>/api/webhooks/...`. A Lumo that is only reachable on a
private network gets no GitHub webhooks (no PR sync, no comment mirror, no
installation updates), no Slack mentions and no Sentry alerts.

If the server is not public, use a tunnel and make its URL the public URL:

```bash
# Cloudflare Tunnel — quick tunnel for a test (the hostname changes on each run)
cloudflared tunnel --url http://localhost:3000
# a named tunnel keeps a stable hostname:
#   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

# ngrok — a free account has one static domain
ngrok http --url=<your-static-domain>.ngrok-free.app 3000
```

Then set `NEXT_PUBLIC_APP_URL` (and `BETTER_AUTH_URL`, if you set it) to the
tunnel's `https://` URL, rebuild, and sign in **through the tunnel URL**:
sign-in is refused from any other origin, and the connect flows return to
`NEXT_PUBLIC_APP_URL`. A quick tunnel's hostname changes on every start, so
every provider URL below would need updating each time — use a stable
hostname for anything beyond a one-off test. Exposing only
`/api/webhooks/*` through the tunnel is enough for the webhooks themselves,
but OAuth needs the browser to reach the whole app on that URL.

## GitHub App

The App is what touches repositories: listing them, PR links and sync,
comment mirroring, CI status. Nothing runs on a member's token.

### 1. Create the App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
(for an organization: the org's **Settings → Developer settings**).

| Field                                                  | Value                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| GitHub App name                                        | anything; its URL slug becomes `GITHUB_APP_SLUG` (`https://github.com/apps/<slug>`)  |
| Homepage URL                                           | `https://lumo.example.com`                                                           |
| Callback URL                                           | `https://lumo.example.com/api/github/app/callback`                                   |
| Expire user authorization tokens                       | either (Lumo revokes the user token right after use)                                 |
| Request user authorization (OAuth) during installation | **off** — Lumo asks for it itself after the setup step                               |
| Setup URL                                              | `https://lumo.example.com/api/github/app/setup`                                      |
| Redirect on update                                     | **off** — the setup step requires the `state` Lumo adds when you start from the card |
| Webhook → Active                                       | on                                                                                   |
| Webhook URL                                            | `https://lumo.example.com/api/webhooks/github`                                       |
| Webhook secret                                         | `openssl rand -hex 32` → `GITHUB_APP_WEBHOOK_SECRET`                                 |
| Where can this GitHub App be installed?                | "Only on this account" is enough for one organization                                |

Why both URLs: GitHub sends the installer to the **Setup URL**
(`app/api/github/app/setup/route.ts`) with `installation_id` and Lumo's
encrypted `state`. Lumo does not trust that id: it sends the user through the
App's user authorization (`lib/integrations/github/app-user-auth.ts`), and
the **Callback URL** (`app/api/github/app/callback/route.ts`) checks with the
user's token that `GET /user/installations` lists the installation, records
the repositories that user can read (`GET
/user/installations/{id}/repositories`), and revokes the token.

### 2. Repository permissions

The minimum for what Lumo's code calls and subscribes to:

| Permission    | Access       | Why (source)                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metadata      | Read         | mandatory; `GET /installation/repositories` (`lib/integrations/github/app-installations.ts`), `GET /repos/{r}/collaborators/{login}/permission` for the access recheck (`lib/integrations/github/collaborator-access.ts`); the `repository` event                                                                         |
| Contents      | Read         | file reads and a PR's `.diff` (`REPO_TOKEN_PERMISSIONS.contentsRead` in `lib/integrations/github/token-permissions.ts`, used by `lib/integrations/github/contents.ts`); the `push` event                                                                                                                                  |
| Pull requests | Read & write | PR JSON, file list, PR list (`pullRequestRead`: `lib/services/task-pr-sync.service.ts`, `task-pr-link.service.ts`, `stale-pr-reconcile.service.ts`, `github-app-install.service.ts`); posting mirrored comments and replies (`pullRequestWrite`: `lib/services/pr-comment-mirror.service.ts`); the `pull_request*` events |
| Issues        | Read         | only so the App can subscribe to `issue_comment` (GitHub requires Issues read for that event); comments are written with the Pull requests permission                                                                                                                                                                     |
| Checks        | Read         | to subscribe to `check_suite` → the PR's CI status (`handleCheckSuite` in `app/api/webhooks/github/handlers.ts`)                                                                                                                                                                                                          |

Lumo mints every installation token with only the permissions the call needs
(`lib/integrations/github/token-permissions.ts`). Asking for a permission the
App was not granted makes GitHub refuse the token (422), so do not grant
**less** than this table. Organization and account permissions: none.

### 3. Subscribe to events

Handled in `app/api/webhooks/github/route.ts`; anything else is accepted and
ignored.

| Event                                       | What Lumo does                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pull_request`                              | links the PR to its task, tracks state, merge and change volume                                 |
| `push`                                      | records the branch's last commit on its task; detects reverts on the default branch             |
| `check_suite`                               | `completed` → the PR's CI status (success / pending / failure)                                  |
| `issue_comment`                             | mirrors PR conversation comments into the task                                                  |
| `pull_request_review`                       | mirrors reviews                                                                                 |
| `pull_request_review_comment`               | mirrors line comments                                                                           |
| `repository`                                | `renamed` follows the new name; `transferred` / `deleted` / `privatized` re-check access        |
| `installation`, `installation_repositories` | always delivered to every App (no checkbox): keep the installation and its repositories current |

### 4. Credentials → environment

On the App's **General** page:

```dotenv
GITHUB_APP_SLUG=<app-slug>                 # from https://github.com/apps/<app-slug>
GITHUB_APP_ID=<numeric App ID>
GITHUB_APP_CLIENT_ID=<App client ID>       # the App's, not an OAuth App's
GITHUB_APP_CLIENT_SECRET=<generated client secret>
GITHUB_APP_WEBHOOK_SECRET=<the webhook secret you chose>
GITHUB_APP_PRIVATE_KEY="<the .pem on one line, newlines written as \n>"
```

**Private keys → Generate a private key** downloads a `.pem`. Lumo accepts
the full PEM with real newlines, the PEM on one line with `\n` escapes, or
the base64 body alone (`appCredentials` in `lib/integrations/github/auth.ts`).
For a `.env` file the one-line form is the safe one:

```bash
awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' <downloaded-key>.pem
```

### 5. Install and verify

1. `docker compose up -d`, then open **Settings → Integrations**: the GitHub
   card appears (if it does not, one of the six variables or
   `ENCRYPTION_KEY` is empty — check `.env`). Start the install from the
   card, not from the App's public page: the setup step needs Lumo's `state`.
2. **Install** → choose the account and repositories → GitHub returns to
   Lumo, asks you to authorize the App once, and lands on the integrations
   page with `?github_app=installed`. The card lists the repositories you
   can read. `?github_app_error=…` names what failed (e.g.
   `verify_not_configured` = `GITHUB_APP_CLIENT_ID` / `_SECRET` missing).
3. In GitHub, the App's **Advanced → Recent Deliveries** shows the
   `installation` delivery with response **200**. A **401** means
   `GITHUB_APP_WEBHOOK_SECRET` does not match the App's webhook secret; a
   connection error means GitHub cannot reach your URL (see
   [A public URL](#a-public-url-webhooks-and-oauth)).
4. Open a pull request on a confirmed repository whose branch name contains
   a task id (e.g. `lumo/LUM-12-…`): the PR appears on the task.

You can test the webhook endpoint without GitHub. A correctly signed body
returns 200, a wrong signature 401:

```bash
SECRET=<GITHUB_APP_WEBHOOK_SECRET>
BODY='{"zen":"test","hook_id":1}'
SIG="sha256=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lumo.example.com/api/webhooks/github \
  -H 'Content-Type: application/json' -H 'X-GitHub-Event: ping' \
  -H "X-Hub-Signature-256: $SIG" --data "$BODY"
```

### How access stays current

- An installation `suspend` / `deleted` drops the workspace's installation
  record; `installation_repositories` adds or removes repositories; newly
  reachable repositories get their existing pull requests backfilled.
- Only repositories the verifying user could read are confirmed. A
  repository added to the installation later stays out until an owner
  re-verifies from the card (`/api/github/app/reverify`).
- The daily cron `recheck-github-access` (see [cron.md](cron.md)) asks GitHub
  whether the verifier can still read each confirmed repository, narrows the
  list to what the installation still reaches, and unbinds an installation
  GitHub reports as gone. Keep it enabled while the App is in use.
- A workspace without an installation gets no GitHub token at all; there is
  no global fallback installation.

## GitHub OAuth App

Optional, per member: links a member's GitHub login so comments arriving
from GitHub are attributed to them. It reads nothing else.

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**.
2. Homepage URL `https://lumo.example.com`; **Authorization callback URL**
   `https://lumo.example.com/api/github/callback`.
3. Generate a client secret.

```dotenv
GITHUB_CLIENT_ID=<OAuth App client ID>
GITHUB_CLIENT_SECRET=<OAuth App client secret>
```

- Scope requested: `read:user` only (`app/api/github/oauth/route.ts`); the
  callback calls `GET /user` (`app/api/github/callback/route.ts`).
- No webhook.
- These are not the `AUTH_GITHUB_*` variables of "Sign in with GitHub"
  ([README](README.md#sign-in)) and not the App's client id; three separate
  GitHub registrations are possible and each has its own callback URL.

**Verify:** the member's row on the integrations page → **Connect** →
authorize → the row shows the GitHub login.

## Slack

Per workspace: notifications, task context from channels, `@Lumo` and
`/lumo` commands.

1. <https://api.slack.com/apps> → **Create New App → From scratch**.
2. **OAuth & Permissions → Redirect URLs**:
   `https://lumo.example.com/api/slack/callback` (Slack requires `https`).
3. **Bot Token Scopes** — exactly what Lumo's install link requests
   (`SLACK_SCOPES` in `app/api/slack/oauth/route.ts`):

   | Scope               | Used for (source)                                                                                          |
   | ------------------- | ---------------------------------------------------------------------------------------------------------- |
   | `chat:write`        | `chat.postMessage` — notifications and command replies (`lib/integrations/slack/notify.ts`)                |
   | `channels:read`     | `conversations.list` / `conversations.info` — channel picker (`app/api/slack/available-channels/route.ts`) |
   | `groups:read`       | the same for private channels                                                                              |
   | `channels:history`  | `conversations.history` / `replies` — task context (`lib/integrations/slack/context-fetcher.ts`)           |
   | `groups:history`    | the same for private channels                                                                              |
   | `users:read`        | `users.info` — map the Slack user of a command (`lib/integrations/slack/commands.ts`)                      |
   | `users:read.email`  | `users.lookupByEmail` — find a member's Slack user for DMs and invites                                     |
   | `im:write`          | `conversations.open` — direct-message notifications                                                        |
   | `app_mentions:read` | the `app_mention` event                                                                                    |
   | `commands`          | the `/lumo` slash command (step 5)                                                                         |
   | `channels:manage`   | `conversations.create` / `invite` — create a public channel from Lumo (`lib/services/slack.service.ts`)    |
   | `groups:write`      | the same for private channels                                                                              |

4. **Event Subscriptions** → on; **Request URL**
   `https://lumo.example.com/api/webhooks/slack` (Slack verifies it at once;
   Lumo answers the `url_verification` challenge, so Lumo must already be
   running with `SLACK_SIGNING_SECRET` set). **Subscribe to bot events:**
   `app_mention` — the only event Lumo handles
   (`app/api/webhooks/slack/route.ts`).
5. **Slash Commands → Create New Command**: command `/lumo`, **Request URL**
   the same `https://lumo.example.com/api/webhooks/slack`, usage hint e.g.
   `status LUM-12`. Slack sends slash commands form-encoded and events as
   JSON; the route verifies the signature on the raw body first, then parses
   by `Content-Type` (`lib/integrations/slack/request.ts`).
6. **Basic Information → App Credentials**:

```dotenv
SLACK_CLIENT_ID=<Client ID>
SLACK_CLIENT_SECRET=<Client Secret>
SLACK_SIGNING_SECRET=<Signing Secret>
```

Requests whose timestamp is more than 5 minutes off, or with a bad
`X-Slack-Signature`, are rejected (401), so the server clock must be correct.

A workspace that connected Slack before a scope was added (e.g.
`channels:manage` / `groups:write`) keeps its old token until it is
re-authorized: creating a channel then shows **Reconnect Slack**, which
re-runs the install with the current scopes and updates the stored token
(channel subscriptions are kept — unlike Disconnect, which removes them).

Posting to a channel needs the bot to be a member of it (`/invite @<app>`).

**Verify:** **Settings → Integrations → Slack → Connect** → allow → the card
shows the Slack workspace. Then mention the app in a channel it is in:
`@<app> status <TASK-ID>` (e.g. `LUM-12`) replies with the task card, and
`/lumo status <TASK-ID>` does the same.

## Figma

Per member: Figma links on tasks show a preview and frame context.

1. <https://www.figma.com/developers/apps> → **Create a new app**.
2. **Callback URL** `https://lumo.example.com/api/figma/callback`.
3. Enable the scopes Lumo requests (`FIGMA_OAUTH_SCOPES` in
   `lib/integrations/figma/oauth.ts`):
   - `file_content:read` — `GET /v1/files/:key`, `/v1/files/:key/nodes`,
     `/v1/images/:key` (`lib/integrations/figma/client.ts`)
   - `file_metadata:read` — the file name
   - `current_user:read` — `GET /v1/me` for the connected account
     (`lib/services/figma-integration.service.ts`)
4. No webhook.

```dotenv
FIGMA_OAUTH_CLIENT_ID=<client id>
FIGMA_OAUTH_CLIENT_SECRET=<client secret>
FIGMA_OAUTH_REDIRECT_URI=https://lumo.example.com/api/figma/callback
```

`FIGMA_OAUTH_REDIRECT_URI` is sent verbatim and must equal the app's
callback URL character for character.

**Verify:** the member's Figma row → **Connect** → allow → the row shows the
Figma account; paste a Figma file link into a task and it renders a preview.

## Google Drive

Per member: import a Google Doc as a Lumo document and re-sync it.

1. <https://console.cloud.google.com/> → create or pick a project →
   **APIs & Services → Library → Google Drive API → Enable**.
2. **OAuth consent screen**: add the scopes below. While the app is in
   _Testing_, add every user who will connect as a test user; `drive.readonly`
   is a restricted scope, so publishing to arbitrary external users needs
   Google's verification (an _Internal_ app in a Google Workspace does not).
3. **Credentials → Create credentials → OAuth client ID → Web application**;
   **Authorized redirect URI** `https://lumo.example.com/api/google-drive/callback`.

Scopes requested (`GOOGLE_DRIVE_OAUTH_SCOPES` in
`lib/integrations/google-drive/oauth.ts`), with `access_type=offline` and
`prompt=consent` so a refresh token is always issued:

- `https://www.googleapis.com/auth/drive.readonly` — `GET
/drive/v3/files/{id}` and `/files/{id}/export?mimeType=text/markdown`
  (`lib/integrations/google-drive/client.ts`)
- `openid`, `email` — `GET /oauth2/v3/userinfo` to show the connected account
  (`lib/services/google-drive-integration.service.ts`)

No webhook.

```dotenv
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_DRIVE_OAUTH_REDIRECT_URI=https://lumo.example.com/api/google-drive/callback
```

These are separate from `AUTH_GOOGLE_*` ("Continue with Google") and must
be a **different** OAuth client: the Drive flow asks Google to include
previously granted scopes, so a shared client makes the sign-in consent
screen list Drive access too. Lumo logs a warning at start-up when
`AUTH_GOOGLE_CLIENT_ID` equals `GOOGLE_CLIENT_ID`.

**Verify:** the member's Google Drive row → **Connect** → choose the account
→ the row shows the email; then import a Google Doc into a project.

## Sentry

Per workspace: a Sentry issue alert creates (or reopens) a Lumo task.
Nothing to set in the environment besides `ENCRYPTION_KEY`: the credentials
are entered on the Sentry card and stored encrypted.

1. Sentry → **Settings → Developer Settings → Custom Integrations → Create
   New Integration → Internal Integration**.
2. **Webhook URL** `https://lumo.example.com/api/webhooks/sentry`;
   turn on **Alert Rule Action**. Permissions: none — Lumo never calls the
   Sentry API; it only receives webhooks.
3. Save and copy the integration's **Client Secret**.
4. In Lumo, **Settings → Integrations → Sentry → Connect**: your
   organization slug and the client secret. Then add **project mappings**
   (Sentry project slug → Lumo project).
5. In Sentry, create an **issue alert rule** whose action is "Send a
   notification via <your integration>".

How deliveries are matched (`lib/services/sentry.service.ts`):

- The organization is read from the host of `data.event.web_url`
  (`<org-slug>.sentry.io` → `<org-slug>`), so it works with sentry.io's
  organization subdomains. A self-hosted Sentry whose event URLs are not
  `<org-slug>.<domain>` cannot be matched (404 `Unknown org`).
- `Sentry-Hook-Signature` is checked against the stored client secret
  (HMAC-SHA256 of the body); a mismatch answers 401.
- An alert for an unmapped project is accepted and skipped; a repeat alert
  for a linked issue adds an activity and reopens a done task.

**Verify:** trigger the alert rule (Sentry's **Send Test Notification** on
the rule): the card's "Last verified webhook" time updates, and with a
mapping a task appears in the mapped project.

## Turning an integration off

Remove its variables and restart. The card disappears and its routes answer
404; stored connections stay in the database and work again once the
variables are back (with the same `ENCRYPTION_KEY`).
