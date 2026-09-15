# AccessPing

Evidence-first venue accessibility checks. Paste a venue or event URL, get a source-backed checklist for six practical access details, and ask the venue only about the missing facts. Venue email replies update the checklist in realtime.

Live app: https://greedy-duck-315.convex.site

## How it works

1. **Research** — Firecrawl scrapes the submitted page with link discovery, maps the site for accessibility pages, ranks same-origin candidates by accessibility signal, and scrapes up to five sourced pages. A viewport screenshot lands in Convex file storage as visual evidence. OpenAI (`gpt-5.6-luna` via the configured endpoint) extracts exactly six requirements. Anything without explicit evidence stays `unknown`; inconsistent evidence becomes `conflicting`.
2. **Prioritise** — the user marks which unknowns matter. Priorities shape follow-up only, never evidence.
3. **Outreach** — AgentMail sends one focused message with only the still-unverified questions (priority-first). Max 3 sends per case with a 60s cooldown.
4. **Reply** — the signed AgentMail `message.received` webhook (plus a manual “Check for reply now” fallback) parses the venue reply. `unknown` → `confirmed_venue`; corrections to web-sourced rows surface as `conflicting` for human review instead of silently overwriting.
5. **Monitor** — a weekly cron re-scrapes researched venues. Vanished evidence flips rows to `conflicting`, new confirmations upgrade `unknown` rows, and opted-in owners get an AgentMail alert summarising the changes.
6. **Share** — every check mints a read-only `?share=` link (no account needed) with the ledger, sources, and snapshot.

## Stack

React 19, TypeScript, Vite, Convex (schema, queries, mutations, actions, Node actions, HTTP actions, realtime), `@convex-dev/static-hosting`, Firecrawl, AgentMail, OpenAI SDK.

## Getting started

```bash
npm install
npx convex dev        # provisions VITE_CONVEX_URL and pushes schema
npm run dev
```

### Environment

Copy `.env.example`. Client:

- `VITE_CONVEX_URL` — set automatically by `npx convex dev`.

Server (`npx convex env set KEY value`):

- `FIRECRAWL_API_KEY` (required)
- `FIRECRAWL_WEBHOOK_SECRET` (optional, unused by single-scrape flow)
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional, default `gpt-5.6-luna`)
- `OPENAI_BASE_URL` (optional, dev only)
- `AGENTMAIL_API_KEY` (required)
- `AGENTMAIL_BASE_URL` (optional)
- `AGENTMAIL_WEBHOOK_SECRET` (optional locally, **required in production** — webhook returns 503 without it)
- `AGENTMAIL_INBOX_ID` / `AGENTMAIL_INBOX_EMAIL` (optional — auto-provisioned otherwise)
- `SITE_URL` (required for auth — `http://localhost:5173` locally, the `.convex.site` URL in production)
- `JWT_PRIVATE_KEY` / `JWKS` (required for auth — generate with `node` + `jose`, see Convex Auth manual setup)

Register the production webhook: AgentMail `message.received` → `https://<deployment>.convex.site/agentmail/webhook`.

### Scripts

- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run typecheck` — `tsc -b`
- `npm run lint` — oxlint
- `npm test` — Node built-in test runner (`src/**/*.test.ts`)
- `npm run deploy` — static-hosting deploy

## Ownership model

Every visitor is auto-signed in with anonymous Convex Auth (`@convex-dev/auth`). Each created case is stamped with the auth user id **and** a browser-session `ownerToken` stored in localStorage:

- Reads (`getBundle`), priority changes, research retries, deletes, and outreach sends require the auth identity or the token when the case has markers; legacy open cases stay readable.
- `myCases` lists the signed-in user's checks across browsers; deep links (`?case=<id>`) work on the creating browser.
- History (`getHistory`) verifies every `(caseId, ownerToken)` pair server-side and also matches the caller identity.
- Global brake: max 60 case creates/hour. Per-case: max 3 venue sends + 60s cooldown, max 3 research attempts.

## Data model

- `cases` — url, venueName, status (`queued|researching|ready|failed`), error, userId, ownerToken, shareToken, ownerEmail, recheckEnabled, lastRecheckAt, screenshotId, attemptCount, researchSources, researchModel.
- `requirements` — caseId, key (6 fixed), label, status (`confirmed_web|confirmed_venue|unknown|conflicting`), isPriority, answer, evidence, sourceUrl.
- `outreach` — caseId, recipient, inboxId, threadId, messageId, questions, replyText, status (`draft|pending|sent|replied|failed`).
- `emailEvents` — webhook dedupe by eventId.
- `settings` — AgentMail inbox cache.

Retention: delete checks from the Recent list any time. A weekly cron runs `cases:purgeOld` (failed/queued cases older than 30 days) and `recheck:runBatch` (re-verifies ready checks untouched for 7+ days, max 3 per run).

## Testing

`npm test` runs pure unit tests (URL validation, outreach guards). Convex integration for `saveAnalysis`/`applyVenueReply`/webhook dedupe is exercised via the production smoke in `hackathon.md`; add `convex-test` coverage before scaling outreach.

## Deployment

Frontend is served from Convex static hosting (`.convex.site`). Backend + cron + `/health` and `/agentmail/webhook` run on the same Convex deployment.
