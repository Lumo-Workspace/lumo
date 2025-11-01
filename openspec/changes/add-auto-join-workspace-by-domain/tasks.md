## 1. Spec & Design

- [x] 1.1 Review existing team-onboarding spec
- [x] 1.2 Finalize domain-based auto-join requirements and scenarios
- [x] 1.3 Design dgomain-to-workspace mapping (Team.domain or DomainWorkspace table)

## 2. Database

- [x] 2.1 Add `domain` field to Team model (nullable, unique per domain)
- [x] 2.2 Add `allowAutoJoin` field to Team model (boolean, default: true)
- [x] 2.3 Create migration for domain and allowAutoJoin fields and index

## 3. Constants & Utilities

- [x] 3.1 Define public email domains list (gmail.com, outlook.com, yahoo.com, etc.)
- [x] 3.2 Create utility to extract email domain
- [x] 3.3 Create utility to check if domain is public email provider

## 4. Auto-join Logic

- [x] 4.1 Implement auto-join in NextAuth signIn callback
- [x] 4.2 Find existing Team by domain (if not public email)
- [x] 4.3 Check if Team.allowAutoJoin is true
- [x] 4.4 If Team found and allowAutoJoin=true: Create TeamMember with default role (member)
- [x] 4.5 If Team not found or allowAutoJoin=false: Skip auto-join, proceed to onboarding

## 5. Tests

- [ ] 5.1 Unit: domain extraction and public email detection
- [ ] 5.2 Integration: auto-join flow for company email
- [ ] 5.3 Integration: public email should skip auto-join
