import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const requirementStatus = v.union(
  v.literal('confirmed_web'),
  v.literal('confirmed_venue'),
  v.literal('unknown'),
  v.literal('conflicting'),
)

export default defineSchema({
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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_createdAt', ['createdAt']),

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
