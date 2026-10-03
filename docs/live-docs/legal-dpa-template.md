# Lumo Data Processing Agreement (Template)

Version: 2026-10-03 · Draft for legal review (LUM-857)

This Data Processing Agreement ("DPA") forms part of the agreement for the Lumo service (the "Agreement") between [Customer legal name] ("Customer") and [Lumo legal entity], [registered address] ("Lumo"). It applies where Lumo processes Customer Personal Data on Customer's behalf in providing the Service, and it sets out the terms required by Article 28(3) of Regulation (EU) 2016/679 (the "GDPR") and the equivalent UK and Swiss laws. If this DPA conflicts with the Agreement, this DPA prevails on data protection matters.

## 1. Definitions

- "Data Protection Laws" means the GDPR, the UK GDPR and Data Protection Act 2018, the Swiss Federal Act on Data Protection, and any other data protection law that applies to the processing under this DPA.
- "Customer Personal Data" means personal data contained in data that Customer or its users submit to, or connect to, the Service and that Lumo processes on Customer's behalf.
- "Subprocessor" means a third party engaged by Lumo that processes Customer Personal Data.
- "Security Incident" means a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, Customer Personal Data.
- "SCCs" means the standard contractual clauses approved by European Commission Implementing Decision (EU) 2021/914, and "UK Addendum" means the International Data Transfer Addendum issued by the UK Information Commissioner.
- "controller", "processor", "data subject", "personal data" and "processing" have the meanings given in the GDPR.

## 2. Roles and scope

2.1 Customer is the controller (or a processor acting for its own controllers) and Lumo is the processor of Customer Personal Data.

2.2 Lumo is an independent controller of the account data it needs to run user accounts, security and its own business relationship with Customer; that processing is described in the Lumo Privacy Policy and is outside this DPA.

## 3. Details of processing

The subject matter, nature, purpose, duration, and the categories of data and data subjects are set out in Annex 1.

## 4. Processing on documented instructions

4.1 Lumo processes Customer Personal Data only on Customer's documented instructions, including with regard to international transfers, unless required to do otherwise by Union or Member State law, in which case Lumo will inform Customer of that requirement before processing unless the law prohibits it.

4.2 The Agreement, this DPA, and Customer's configuration and use of the Service (including connecting integrations, installing the Lumo GitHub App and CLI hooks, and setting retention periods) are Customer's complete instructions. Lumo will tell Customer promptly if, in its opinion, an instruction infringes Data Protection Laws.

4.3 Lumo does not sell Customer Personal Data and does not use it, or allow its Subprocessors to use it, to train artificial intelligence models.

## 5. Confidentiality

Lumo ensures that every person it authorises to process Customer Personal Data is bound by an appropriate obligation of confidentiality, and gives access only to personnel who need it to provide, support or secure the Service.

## 6. Security

Lumo implements and maintains the technical and organisational measures described in Annex 2, which are designed to ensure a level of security appropriate to the risk, as required by Article 32 GDPR. Lumo may update these measures provided the overall level of security is not reduced.

## 7. Subprocessors

7.1 **General authorisation.** Customer gives Lumo general written authorisation to engage Subprocessors. The Subprocessors engaged on the date of this DPA are listed on Lumo's subprocessor page at [link to subprocessor page] (Annex 3).

7.2 **Change notice.** Lumo will notify Customer of any intended addition or replacement of a Subprocessor at least [30] days before the change takes effect, by updating the subprocessor page and by email to the workspace owner's address (or another address Customer designates). Where a change is needed urgently to keep the Service secure or available, Lumo will notify Customer as soon as reasonably practicable.

7.3 **Objection.** Customer may object to a new Subprocessor on reasonable data protection grounds by writing to [privacy@uselumo.ai] within the notice period. The parties will discuss the objection in good faith. If Lumo cannot offer a reasonable alternative, Customer may terminate the affected part of the Service without penalty and receive a pro-rata refund of prepaid fees for the terminated period.

7.4 **Flow-down and liability.** Lumo imposes on each Subprocessor, by written contract, data protection obligations that offer at least the same protection as this DPA, and remains liable to Customer for each Subprocessor's performance of those obligations.

7.5 **AI model providers.** Requests to AI models are sent through the Vercel AI Gateway with zero data retention enforced on every request, so they are only served by providers that have agreed not to retain the data or use it for training. The provider that serves a given request is selected by the gateway from the listed providers based on availability. Requests are routed globally, so they may be processed outside Customer's region; zero data retention applies wherever they are processed, and Lumo does not commit to a processing location for them.

## 8. Assistance to Customer

8.1 **Data subject requests.** Taking into account the nature of the processing, Lumo will assist Customer by appropriate technical and organisational measures in responding to requests from data subjects to exercise their rights. If Lumo receives such a request directly, it will refer the data subject to Customer and will not respond itself unless Customer authorises it. Workspace deletion, a self-service workspace export, and immediate permanent deletion of individual tasks and documents from the trash are available to Customer through the Service. The self-service export does not yet include every record Lumo stores; Lumo provides the remaining Customer Personal Data on request.

8.2 **Other assistance.** Lumo will provide reasonable assistance with Customer's security obligations, data protection impact assessments and prior consultations with supervisory authorities under Articles 32 to 36 GDPR, taking into account the nature of the processing and the information available to Lumo.

## 9. Security Incidents

Lumo will notify Customer without undue delay, and in any case within [48] hours, after becoming aware of a Security Incident affecting Customer Personal Data. The notice will describe, as far as then known, the nature of the incident, the categories and approximate number of data subjects and records concerned, the likely consequences, and the measures taken or proposed. Lumo will provide further information as it becomes available and take reasonable steps to contain and remedy the incident.

## 10. Deletion or return at the end of the Service

10.1 On termination of the Service, or earlier on Customer's written request, Lumo will, at Customer's choice, return Customer Personal Data to Customer in a commonly used machine-readable format or delete it, unless Union or Member State law requires Lumo to keep it.

10.2 Customer may delete a workspace at any time from workspace settings. The deletion is scheduled 48 hours ahead, every workspace owner is notified by email, and any owner can cancel it during that window; when the window ends, the workspace's database records and stored files are permanently deleted. An owner can instead run a scheduled deletion immediately. Lumo keeps a deletion receipt recording what was deleted and when, which contains no Customer Personal Data beyond identifiers.

10.2a Tasks and documents that users delete are held in the workspace's trash for 30 days, during which they can be restored, and are then permanently deleted automatically. Users can permanently delete a trashed item before the 30 days end.

10.3 Deleted data may remain in encrypted backups for up to [backup retention period] until it is overwritten; it is not restored into the Service except to recover from a disaster.

## 11. Audits and information

11.1 Lumo will make available to Customer the information necessary to demonstrate compliance with Article 28 GDPR, including completed security questionnaires and, when available, third-party audit reports.

11.2 Where that information is not sufficient to demonstrate compliance, Lumo will allow for and contribute to audits, including inspections, by Customer or an independent auditor mandated by Customer, on at least [30] days' written notice, during business hours, no more than once in any 12-month period (unless required by a supervisory authority or following a Security Incident), and subject to reasonable confidentiality obligations. Each party bears its own costs.

## 12. International transfers

12.1 Lumo and its Subprocessors process Customer Personal Data in the United States and in the other locations listed on the subprocessor page.

12.2 To the extent Customer Personal Data subject to the GDPR is transferred to a country that has not received an adequacy decision, the SCCs are incorporated into this DPA by reference, as follows: Module Two (controller to processor) where Customer is a controller, and Module Three (processor to processor) where Customer is a processor; Clause 7 (docking clause) applies; Clause 9 option 2 (general authorisation) applies, with the notice period in section 7.2; the optional wording in Clause 11 does not apply; Clause 17 option 1 applies with the law of [Ireland]; the courts of [Ireland] are chosen under Clause 18; and Annexes I to III of the SCCs are completed by Annexes 1 to 3 of this DPA.

12.3 For transfers subject to UK data protection law, the UK Addendum applies, completed with the information in this DPA. For transfers subject to Swiss law, the SCCs apply with the references to the GDPR read as references to the Swiss Federal Act on Data Protection, and the Swiss Federal Data Protection and Information Commissioner as the competent authority where applicable.

12.4 Where a Subprocessor is certified under the EU-U.S. Data Privacy Framework (or its UK and Swiss extensions), Lumo may rely on that certification for onward transfers to it.

## 13. General

13.1 This DPA stays in force for as long as Lumo processes Customer Personal Data under the Agreement.

13.2 The liability of each party under this DPA is subject to the limitations of liability in the Agreement, except where Data Protection Laws do not allow such limitation.

13.3 This DPA is governed by the law that governs the Agreement, except where the SCCs require otherwise.

## Annex 1 — Details of processing

| Item | Description |
| --- | --- |
| Subject matter | Provision of the Lumo project-management service for teams working with AI coding agents to Customer |
| Nature of processing | Collection, storage, organisation, retrieval, analysis (including automated analysis by AI models and static security analysis), transmission to connected integrations, and deletion |
| Purpose | To provide, secure and support the Service as described in the Agreement, including tracking AI coding-agent sessions, recording test-case runs and checking whether a task can be marked done, reviewing pull requests for security issues, and generating summaries and team memory |
| Duration | For the term of the Agreement and until deletion under section 10 |
| Frequency | Continuous |
| Retention | As configured by Customer in the Service's data retention settings: agent session records are kept by default, or have their content removed 30, 90, 180 or 365 days after each event, or are discarded 7 days after they are used up (in that mode file contents and command output are never stored); security scan evidence is cleared 7 days after the pull request is merged or closed by default (0, 7, 14 or 30 days selectable; at most 30 days after a scan on a pull request that stays open); boundary-crossing originals are replaced by a code-free description 7 days after disposition by default (7, 30 or 90 days selectable); failed comment-sync webhook payloads are deleted 7 days after the failure by default (7, 30 or 90 days selectable). AI-derived team memory, session summaries and run summaries are generated by default with code removed and are kept for as long as the workspace exists, unless Customer turns their generation off or deletes them in the same settings (the deletion also clears AI-written task claims and the explanations of claim faithfulness checks, and does not affect agent session records); other data is kept for as long as the workspace exists |

Categories of data subjects:

- Customer's employees, contractors and other users invited to Customer's workspaces.
- Individuals whose personal data appears in content Customer submits or connects, such as authors named in source code, commit metadata, Slack messages or documents.

Categories of personal data:

| Category | Examples |
| --- | --- |
| User identity and contact data | Name, email address, profile image, role, workspace membership |
| Workspace content | Tasks, documents, comments, ideas, test cases and their run records, team memory, uploaded files |
| Agent hook events | Prompts, tool calls, file contents and command output from AI coding-agent sessions, with detected secrets redacted before storage in every retention mode (file contents and command output are not stored when Customer selects discard when used up) |
| Customer code | Pull-request diffs, repository files and code excerpts in security findings |
| Integration data | Slack messages, Figma file metadata, Google Docs content and Sentry error events that Customer chooses to connect |
| Integration credentials | Access tokens for connected integrations, stored encrypted |
| Technical data | IP addresses, request logs, session identifiers |

Special categories of data: none intended. Customer should not submit special category data to the Service.

## Annex 2 — Technical and organisational security measures

| Area | Measures |
| --- | --- |
| Encryption in transit | All connections to the Service and between the Service and its Subprocessors use TLS |
| Encryption at rest | Database and file storage are encrypted at rest by the hosting providers; integration access tokens are additionally encrypted with AES-256-GCM at the application layer |
| Authentication and access control | User authentication through Clerk; every request is authorised against the user's workspace membership; data of one workspace is not accessible to members of another |
| Least privilege | Production credentials are held in the hosting provider's secret store and are not stored in source code; the GitHub App requests only the repository permissions the Service needs, and scan sandboxes receive short-lived, repository-scoped credentials |
| Isolation of code analysis | Customer repositories are analysed in isolated, short-lived virtual machines that are discarded after each scan |
| AI data handling | Every AI model request enforces zero data retention and excludes providers that would train on or retain the data |
| Data minimisation | Detected secrets are redacted from agent hook events before storage, whatever the retention setting; Customer can set retention for agent session records (including a mode that never stores file contents or command output and discards the rest after use), security scan evidence, boundary-crossing originals and failed comment-sync payloads; code stored with security scans is cleared when the GitHub App is uninstalled or a repository is removed from it |
| Deletion | Workspace deletion runs after a 48-hour cancellation window (or immediately at an owner's request), removes database records and stored files and produces a deletion receipt; deleted tasks and documents are kept in a 30-day trash and then permanently deleted |
| Availability and resilience | Managed database with automated backups and point-in-time recovery; application hosted on a managed serverless platform |
| Secure development | Every change goes through a pull request with automated tests and automated security scanning |
| Incident response | Security Incidents are handled and notified under section 9; vulnerabilities can be reported to [security@uselumo.ai] |
| Subprocessor management | Subprocessors are bound by written data protection terms under section 7 |

## Annex 3 — Subprocessors

The authorised Subprocessors, their purposes and data locations are listed on the Lumo subprocessor page: [link to subprocessor page].

## Signatures

| | Customer | Lumo |
| --- | --- | --- |
| Name | | |
| Title | | |
| Date | | |
| Signature | | |
