# Lumo Privacy Policy

Last updated: 2026-09-26 · Draft for legal review (LUM-857)

This policy explains what personal data [Lumo legal entity], [registered address] ("Lumo", "we", "us") collects when you use the Lumo website, web application, command-line tool (CLI) and integrations (together, the "Service"), why we collect it, how long we keep it, who we share it with, and the rights you have.

## Who is responsible for your data

- **Account data** (your name, email address and sign-in details): Lumo is the controller.
- **Workspace data** (everything your team puts into or connects to a Lumo workspace, including code): the customer that owns the workspace is the controller and Lumo is its processor. We process it only to provide the Service and on the customer's instructions, under our Data Processing Agreement (DPA). If you are a member of someone else's workspace, contact that workspace's owner first about your data in it; we will help them respond.

## What data we collect

| Category | What it includes | Where it comes from |
| --- | --- | --- |
| Account data | Name, email address, profile image, sign-in method, workspace memberships and roles | You, when you sign up or are invited; your identity provider if you sign in with one |
| Workspace content | Tasks, projects, milestones, sprints, ideas, documents, comments, acceptance criteria, test cases, team memory, and files you upload (images, logos, test evidence) | You and your teammates |
| Agent hook events | Records of AI coding-agent sessions sent by the Lumo CLI hooks: prompts, tool calls, file contents the agent read or wrote, command output, session summaries | The Lumo CLI running on your team's machines, once installed |
| Customer code | Pull-request diffs, repository files, check results and code excerpts attached to security findings | The Lumo GitHub App on repositories your admin installs it on |
| Integration tokens | OAuth and access tokens for GitHub, Slack, Figma and Google Drive, and webhook secrets | You, when you connect an integration |
| Technical data | IP address, browser and device information, request logs, session cookies | Your browser or CLI when it calls the Service |

We do not use advertising trackers or third-party analytics on the Service, and we do not sell personal data.

Agent hook events and customer code can contain personal data that happens to appear in your source code or prompts, such as author names or email addresses. Secrets recognised by our detector (for example API keys and tokens) are redacted from hook events before they are stored.

## How we use data

| Purpose | Data used | Legal basis (GDPR) |
| --- | --- | --- |
| Provide the Service: show and sync your workspace, run agent-session tracking, acceptance verification and team memory | Account data, workspace content, agent hook events | Performance of our contract with you or your organisation |
| Review pull requests for security issues and post results back to GitHub | Customer code | Performance of contract |
| AI features: security review, summaries, memory extraction, planning and task suggestions | Workspace content, agent hook events, customer code | Performance of contract |
| Authenticate you and keep accounts secure; prevent abuse through rate limiting | Account data, technical data | Legitimate interest in running a secure service |
| Send invitations and service messages | Account data | Performance of contract |
| Diagnose faults and keep the Service reliable | Technical data | Legitimate interest |
| Meet legal obligations and respond to lawful requests | Any, as required | Legal obligation |

We do not use your workspace content, agent hook events or code to train AI models, and we do not allow our AI providers to do so.

### AI processing

When an AI feature runs, the relevant text (which may include code) is sent to a large language model through the Vercel AI Gateway. Every request is sent with zero data retention enforced: it is only routed to model hosts that have agreed not to store the data or train on it, and it fails rather than going to a host that would. Please note:

- OpenAI's zero-data-retention terms allow limited retention for abuse monitoring ("safety retention").
- Open-weight models (such as the DeepSeek and GLM families) are run by third-party hosting providers listed on our subprocessor page, not by the model authors.
- The gateway does not tell us the region in which a hosting provider processes a request, so we cannot currently commit to a location for AI processing.

## How long we keep data

| Data | Retention |
| --- | --- |
| Account data | While your account is active. We delete it on request, unless we must keep some of it to meet a legal obligation. |
| Workspace content | For as long as the workspace exists. Older document revisions are thinned automatically (one per day for the last week, then one per week). |
| Agent hook events | For as long as the workspace exists, by default. A workspace owner can set a retention period of 30, 90, 180 or 365 days, after which the content of older events is removed and only metadata is kept. Two kinds of event are kept in full: events of tasks that are not yet done, until the task is done, and events cited as evidence in a boundary-crossing review record, for as long as that record exists. |
| Customer code | Repositories cloned for a scan exist only in a short-lived sandbox that is discarded after the scan. Scan results and the code excerpts attached to findings are kept for as long as the workspace exists. |
| Integration tokens | Until the integration is disconnected or the workspace is deleted. |
| Technical data and logs | [Log retention period] |
| Backups | Deleted data can persist in encrypted database backups for up to [backup retention period] before it is overwritten. |

When a workspace owner deletes a workspace, we permanently delete its database records and stored files and keep a deletion receipt recording what was deleted and when (not the deleted content). If you uninstall the GitHub App but keep the workspace, data already collected from GitHub is kept with the workspace; contact us if you want it deleted.

## Who we share data with

- **Subprocessors** that host and run the Service for us, including our database, hosting, authentication, email, real-time messaging and AI model providers. The current list, with each provider's purpose and data location, is on our subprocessor page: [link to subprocessor page]. They may only use the data to provide their service to us.
- **Integrations you connect** (GitHub, Slack, Figma, Google Drive, Sentry). We send data to them only when you or your workspace admin connect them and ask us to.
- **Your workspace**: content you add is visible to other members of that workspace.
- **Authorities** where we are legally required to, and **a successor** if Lumo is involved in a merger or acquisition, in which case this policy continues to apply.

## International transfers

Lumo and most of its subprocessors process data in the United States. Where personal data from the European Economic Area, the United Kingdom or Switzerland is transferred to a country without an adequacy decision, we rely on the European Commission's Standard Contractual Clauses (with the UK Addendum where applicable), and on the EU-U.S. Data Privacy Framework where a recipient is certified under it. AI model hosting providers may process requests in other regions; see "AI processing" above.

## How we protect data

- All traffic to the Service is encrypted in transit with TLS.
- Our database and file storage providers encrypt data at rest.
- Integration access tokens are additionally encrypted with AES-256-GCM before they are stored.
- Sign-in is handled by Clerk; access to workspace data is limited to members of that workspace.
- Security scans of your code run in isolated, short-lived sandboxes.

## Your rights

Depending on where you live, you have the right to:

- **Access** the personal data we hold about you and get a copy of it.
- **Export** your data in a portable, machine-readable format.
- **Correct** inaccurate data. You can edit your profile yourself.
- **Delete** your data. Workspace owners can delete a workspace, and everything in it, from workspace settings.
- **Restrict or object** to processing based on our legitimate interests.
- **Withdraw consent** where we rely on it.
- **Complain** to your data protection authority.

To exercise these rights, email [privacy@uselumo.ai]. We answer within 30 days. Data export and deletion of an individual account are currently handled on request by our team; we will verify your identity before acting. For data in a workspace you do not own, we will pass your request to the workspace owner.

California residents: we do not sell or share personal information for cross-context behavioural advertising, and we will not discriminate against you for exercising your privacy rights.

## Cookies

We use only the cookies needed to keep you signed in and to secure your session. We do not use advertising or cross-site tracking cookies.

## Children

The Service is not directed to children under 16, and we do not knowingly collect their personal data.

## Changes to this policy

If we make material changes, we will update the date above and notify workspace owners by email or in the Service before the changes take effect.

## Contact

[Lumo legal entity], [registered address] · [privacy@uselumo.ai]

EU / UK representative: [if required]
