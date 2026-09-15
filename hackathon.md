# Hackathon log

- **Project:** AccessPing
- **Event:** Convex All Gas Hackathon
- **What it does:** Turns a venue or event URL into a source-backed accessibility checklist, asks the venue only about missing facts, and updates the checklist when the venue replies.
- **Built:** A full URL-to-verification workflow: anonymous Convex Auth signs every visitor in and owns their checks, Firecrawl maps the venue site and scrapes the most accessibility-relevant pages it discovers, unsupported accessibility details remain unverified, the user chooses which gaps matter, AgentMail sends only approved questions, inbound replies are parsed, and Convex updates only the requirements actually answered in real time.
- **Stack:** React 19, TypeScript, Vite, Convex, `@convex-dev/auth` (anonymous sessions), `@convex-dev/static-hosting`, Firecrawl, AgentMail, OpenAI SDK with `gpt-5.6-luna` through the configured OpenAI-compatible endpoint.
- **Live app:** https://greedy-duck-315.convex.site
- **Demo:** pending — add the final public ≤3-minute demo-video URL before submission
- **Repo:** https://github.com/fexx301/accessping
- **Frontend:** Convex static hosting
- **Convex deployment:** https://greedy-duck-315.convex.cloud
- **Components:** @convex-dev/auth, @convex-dev/static-hosting, @firecrawl/firecrawl-convex, @agentmail/convex
- **Convex features:** schema, auth tables, tables, indexes, queries, mutations, actions, Node actions, HTTP actions, realtime queries, anonymous auth sessions
- **Auth:** anonymous Convex Auth sessions — every visitor auto-signs in, cases are stamped with the auth user id, and reads/mutations enforce owner-or-token access
- **AI models:** gpt-5.6-luna
- **Started:** 2026-09-14T18:02:49Z
- **Last updated:** 2026-09-15T04:10:00Z

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

### 2026-09-15 - 1f45fb9
Fixed production LLM execution by moving OpenAI parsing into Convex Node actions while keeping the public research and reply workflows unchanged (`convex/researchNode.ts`, `convex/outreachNode.ts`). Registered the production AgentMail `message.received` webhook and ran a controlled end-to-end smoke test: Firecrawl researched an official venue accessibility page, source-backed facts were saved, two unknowns were asked through AgentMail, and a reply answering only accessible seating changed that row to `confirmed_venue` while quiet space remained `unknown`.

### 2026-09-15 - gap-review
Closed the end-to-end review gaps: per-case ownership tokens with server enforcement, send caps/cooldowns and research attempt limits, webhook replied-state guard, venue corrections to web rows surfacing as `conflicting`, multi-page same-origin research with stable row IDs, deep links + recent-checks history + retry + resend + manual reply sync + copy/download/print, error boundary, skip link and alert/live-region a11y, SEO meta, real README, CI workflow, and Node unit tests for the shared guards (`convex/guards.ts`, `src/guards.test.ts`). Remaining for submission: the ≤3-minute demo-video URL.

### 2026-09-15 - judging-criteria
Closed the judging-criteria gaps: anonymous Convex Auth sessions own every check (`convex/auth.ts`, `convex/auth.config.ts`, auth tables, `cases.userId`, `myCases`), Firecrawl research became real site discovery — entry scrape with links plus `map`, keyword-ranked same-origin follow-up scrapes up to five sourced pages (`convex/research.ts`, shared ranking in `convex/guards.ts` with unit tests) — and the build log now states the full component and feature surface.

### 2026-09-15 - prod-deploy
Deployed to production: backend (`npx convex deploy`) with auth tables and `cases.by_userId`, fresh prod auth keys (`SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`), anonymous `auth:signIn` verified returning RS256 tokens, and frontend rebuilt against the prod deployment (`static-hosting deploy --skip-convex`). Live at https://greedy-duck-315.convex.site (`/` and `/health` 200, new SEO title serving).
