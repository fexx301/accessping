# Hackathon log

- **Project:** AccessPing
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns a venue or event URL into a source-backed accessibility checklist, asks the venue only about missing facts, and updates the checklist when the venue replies.
- **Live app:** https://greedy-duck-315.convex.site
- **Repo:** https://github.com/fexx301/accessping
- **Frontend:** Convex static hosting
- **Convex deployment:** https://greedy-duck-315.convex.cloud
- **Components:** @convex-dev/static-hosting
- **Convex features:** schema, tables, indexes, queries, mutations, actions, HTTP actions, realtime queries
- **Auth:** none
- **AI models:** gpt-5.6-luna
- **Started:** 2026-09-14T18:02:49Z
- **Last updated:** 2026-09-15T01:35:38Z

## Log

### 2026-09-14 - a54d9bc
Created the first AccessPing research workflow and Convex data model for cases and accessibility requirements. The frontend submits venue URLs, the backend researches them, and unsupported details remain unverified rather than being guessed (`convex/schema.ts`, `convex/cases.ts`, `convex/research.ts`, `src/App.tsx`).

### 2026-09-14 - 4d32b01
Redesigned and refined the app into an evidence-first access ledger with responsive mobile and desktop states, source evidence, explicit unknown/conflicting statuses, and focused follow-up controls (`design.md`, `src/App.tsx`, `src/App.css`).

### 2026-09-14 - bd430a7
Added persistent priority selection and approval-gated AgentMail outreach. Added signed inbound webhook handling and reply extraction so venue responses update only the relevant requirement rows through Convex (`convex/outreach.ts`, `convex/emailCallbacks.ts`, `convex/http.ts`, `convex/cases.ts`).

### 2026-09-14 - 36b6ef6
Added a local AgentMail reply-sync fallback for development so the full outbound-message-to-reply-to-reactive-update loop could be verified before production webhook deployment (`convex/outreach.ts`).

### 2026-09-15 - 6c231ae
Finalized the AccessPing branding and selected the hackathon-compliant frontend path. Installed and registered `@convex-dev/static-hosting`, deployed the production backend and static frontend, and verified the public `.convex.site` app serves the production Convex client bundle (`package.json`, `convex/convex.config.ts`, `convex/http.ts`, `src/App.tsx`, `src/App.css`).
