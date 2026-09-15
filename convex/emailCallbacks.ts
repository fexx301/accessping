import { type AgentMailEvent, vEvent } from '@agentmail/convex'
import { internalMutation } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function stringField(value: unknown, key: string): string | null {
  const record = asRecord(value)
  return record && typeof record[key] === 'string' ? record[key] : null
}

function labelsFromThread(thread: unknown): string[] {
  const record = asRecord(thread)
  const labels = record?.labels
  return Array.isArray(labels) ? labels.filter((item): item is string => typeof item === 'string') : []
}

function caseIdFromThread(thread: unknown): string | null {
  const label = labelsFromThread(thread).find((item) => item.startsWith('accessping-case:'))
  return label ? label.slice('accessping-case:'.length) : null
}

function inboundText(message: unknown): string {
  return (
    stringField(message, 'text') ??
    stringField(message, 'extracted_text') ??
    stringField(message, 'preview') ??
    ''
  ).trim()
}

function eventThreadId(event: AgentMailEvent): string | null {
  const payload =
    event.message ??
    event.send ??
    event.delivery ??
    event.bounce ??
    event.complaint ??
    event.reject
  return stringField(payload, 'thread_id') ?? stringField(event.thread, 'thread_id')
}

export const onAgentMailEvent = internalMutation({
  args: { event: vEvent },
  handler: async (ctx, { event }: { event: AgentMailEvent }): Promise<null> => {
    const existingEvent = await ctx.db
      .query('emailEvents')
      .withIndex('by_eventId', (q) => q.eq('eventId', event.event_id))
      .unique()
    if (existingEvent) return null

    await ctx.db.insert('emailEvents', {
      eventId: event.event_id,
      eventType: event.event_type,
      receivedAt: Date.now(),
    })

    const threadId = eventThreadId(event)
    let outreach = threadId
      ? await ctx.db
          .query('outreach')
          .withIndex('by_threadId', (q) => q.eq('threadId', threadId))
          .first()
      : null

    if (!outreach) {
      const labeledCaseId = caseIdFromThread(event.thread)
      if (labeledCaseId) {
        try {
          const caseRecord = await ctx.db.get(labeledCaseId as Id<'cases'>)
          if (caseRecord) {
            outreach = await ctx.db
              .query('outreach')
              .withIndex('by_caseId', (q) => q.eq('caseId', caseRecord._id))
              .order('desc')
              .first()
          }
        } catch {
          outreach = null
        }
      }
    }

    if (!outreach) return null

    if (event.event_type === 'message.received') {
      const text = inboundText(event.message)
      await ctx.db.patch(outreach._id, {
        status: 'replied',
        ...(threadId ? { threadId } : {}),
        ...(text ? { replyText: text } : {}),
        updatedAt: Date.now(),
      })

      if (text) {
        await ctx.scheduler.runAfter(0, internal.outreach.processVenueReply, {
          caseId: outreach.caseId,
          threadId: threadId ?? outreach.threadId ?? '',
          text,
        })
      }
      return null
    }

    const failed = ['message.bounced', 'message.complained', 'message.rejected'].includes(
      event.event_type,
    )
    const sent = ['message.sent', 'message.delivered'].includes(event.event_type)

    if (failed || sent) {
      // Terminal state guard: a late delivery/sent event must never overwrite
      // a venue reply that already arrived.
      if (outreach.status === 'replied') return null
      await ctx.db.patch(outreach._id, {
        ...(threadId ? { threadId } : {}),
        status: failed ? 'failed' : 'sent',
        updatedAt: Date.now(),
      })
    }
    return null
  },
})
