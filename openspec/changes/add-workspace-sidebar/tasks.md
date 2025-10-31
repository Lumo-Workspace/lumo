## 1. Specs

- [ ] 1.1 Validate proposal and align route with `app/workspace/[workspaceUrl]`

## 2. UI Shell

- [ ] 2.1 Create `components/workspace/Sidebar.tsx` using shadcn/ui primitives
- [ ] 2.2 Add `app/workspace/[workspaceUrl]/layout.tsx` that renders Sidebar + `{children}`
- [ ] 2.3 Add placeholder nav items (Home, Documents, Tasks, Settings)
- [ ] 2.4 Add responsive behavior (collapsible on small screens)

## 3. Routing

- [ ] 3.1 Ensure existing `page.tsx` renders inside the new layout without regressions
- [ ] 3.2 Verify redirects still go to `/workspace/{workspaceUrl}`

## 4. QA

- [ ] 4.1 Visual check desktop/mobile
- [ ] 4.2 Lint, typecheck, build
