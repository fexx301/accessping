# AccessPing — All Gas, No Brakes build note

Event source: https://luma.com/convex-allgas-hackathon?tk=462MyT

Primary objective: prize competitiveness.

## Pitch

For people with specific accessibility needs, AccessPing turns a venue or event URL into a source-backed access checklist, asks the venue only what the web cannot answer, and updates the plan when they reply.

## Decisive test

Question: can the system preserve the boundary between explicit evidence and missing information, then update only the relevant unknown field from an inbound venue reply?

Pass condition:

- Every confirmed web field has supporting source evidence.
- Information not supported by the page remains `unknown`.
- Ambiguous material is `unknown` or `conflicting`, never guessed.
- A controlled inbound venue reply changes only the requirement it actually answers.
- The updated state appears reactively through Convex.

## Build contract

Single workflow: venue/event URL + access needs → research official source → show confirmed/unknown information → user approves targeted questions → email venue → receive reply → update checklist live.

Completion evidence: a fresh deployed run shows real Firecrawl research, source-backed confirmed facts, unsupported facts remaining unknown, an AgentMail inquiry sent after approval, an incoming reply, and the corresponding Convex state updating live.

Out of scope: accessibility certification, legal compliance scoring, community reviews, maps/navigation, ticket purchasing, travel planning, bulk outreach, automatic form submission, multi-venue comparison, native mobile apps.

Cut first: crawl monitoring, saved accessibility profiles, multiple simultaneous venues, advanced auth, sharing/social features, nonessential visual polish.

Reconsider only if: the decisive test cannot preserve evidence/unknown boundaries, or an inbound AgentMail reply cannot reliably drive the intended Convex update within the selection spike.

Builder / next milestone: solo builder with AI assistance. Next milestone is a thin deployed path from URL → Firecrawl → structured analysis → Convex → reactive UI.

Pending mandatory conditions: Convex project configuration and sponsor API credentials. Verify final submission/deadline requirements again before submission.
