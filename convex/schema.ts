import { defineSchema, defineTable } from 'convex/server'
import { authTables } from '@convex-dev/auth/server'
import { v } from 'convex/values'

const requirementStatus = v.union(
  v.literal('confirmed_web'),
  v.literal('confirmed_venue'),
  v.literal('unknown'),
  v.literal('conflicting'),
)

export default defineSchema({
  ...authTables,
  cases: defineTable({
    url: v.string(),
    venueName: v.optional(v.string()),
    status: v.union(
      v.literal('queued'),
      v.literal('researching'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    error: v.optional(v.string()),
    // Authenticated owner (Convex Auth user id). Stamped at creation when
    // the caller is signed in; legacy cases without one stay readable via
    // their ownerToken for backwards compat.
    userId: v.optional(v.string()),
    // Ownership token: required for all cases created after this change.
    // Legacy cases without a token remain readable for backwards compat,
    // but all mutations require a match when a token is present.
    ownerToken: v.optional(v.string()),
    // Public read-only share link token. Minted at creation for new cases;
    // older cases mint one on demand via ensureShareToken.
    shareToken: v.optional(v.string()),
    // Opt-in owner email for completion / reply / recheck notifications.
    ownerEmail: v.optional(v.string()),
    // Re-verification loop state.
    recheckEnabled: v.optional(v.boolean()),
    lastRecheckAt: v.optional(v.number()),
    // Evidence screenshot of the venue page, stored in Convex file storage.
    screenshotId: v.optional(v.id('_storage')),
    attemptCount: v.optional(v.number()),
    researchSources: v.optional(
      v.array(v.object({ url: v.string(), chars: v.number() })),
    ),
    researchModel: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_createdAt', ['createdAt'])
    .index('by_userId', ['userId'])
    .index('by_shareToken', ['shareToken']),

  requirements: defineTable({
    caseId: v.id('cases'),
    key: v.string(),
    label: v.string(),
    status: requirementStatus,
    isPriority: v.optional(v.boolean()),
    answer: v.optional(v.string()),
    evidence: v.optional(v.string()),
    sourceUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_caseId', ['caseId']),

  outreach: defineTable({
    caseId: v.id('cases'),
    recipient: v.string(),
    inboxId: v.string(),
    threadId: v.optional(v.string()),
    outboundId: v.optional(v.string()),
    messageId: v.optional(v.string()),
    questions: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          question: v.string(),
        }),
      ),
    ),
    replyText: v.optional(v.string()),
    status: v.union(
      v.literal('draft'),
      v.literal('pending'),
      v.literal('sent'),
      v.literal('replied'),
      v.literal('failed'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_caseId', ['caseId'])
    .index('by_threadId', ['threadId']),

  emailEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    receivedAt: v.number(),
  }).index('by_eventId', ['eventId']),

  settings: defineTable({
    key: v.string(),
    value: v.string(),
    secondary: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_key', ['key']),
})
