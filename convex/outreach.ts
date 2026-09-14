import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { v } from 'convex/values'
import {
  action,
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Doc, Id } from './_generated/dataModel'

const requirementKeys = [
  'step_free_entrance',
  'accessible_toilet',
  'accessible_seating',
  'parking_dropoff',
  'hearing_support',
  'quiet_space',
] as const

type RequirementKey = (typeof requirementKeys)[number]
type InboxSetting = { inboxId: string; email: string }
type Question = { key: string; label: string; question: string }

const questionBank: Record<RequirementKey, string> = {
  step_free_entrance:
    'Is there a step-free entrance to the venue? If so, which entrance should a visitor use?',
  accessible_toilet: 'Is an accessible toilet available, and where is it located?',
  accessible_seating:
    'Is accessible seating or wheelchair space available, and how should it be arranged?',
  parking_dropoff:
    'Is there accessible parking or an accessible drop-off point, and where is it located?',
  hearing_support:
    'Do you provide hearing or communication support such as a hearing loop, captions, or signing?',
  quiet_space: 'Is there a quiet or low-sensory space available for visitors who need one?',
}

const VenueReply = z.object({
  updates: z
    .array(
      z.object({
        key: z.enum(requirementKeys),
        answer: z.string(),
        evidence: z.string(),
      }),
    )
    .max(6),
})

const REPLY_INSTRUCTIONS = `
You extract only accessibility answers explicitly provided by a venue in an email reply.

Rules:
1. Only return an update when the reply explicitly answers that access detail.
2. Do not infer an answer from silence, tone, or general statements.
3. answer should be a concise user-facing summary of what the venue confirmed, including a negative answer if the venue explicitly says a feature is unavailable.
4. evidence should be a short faithful excerpt or close paraphrase from the venue reply.
5. Do not add keys that were not listed as currently unverified.
6. If the reply answers nothing relevant, return an empty updates array.
`

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function stringField(value: unknown, key: string): string | null {
  const record = asRecord(value)
  return record && typeof record[key] === 'string' ? record[key] : null
}

function messageText(message: unknown): string {
  return (
    stringField(message, 'text') ??
    stringField(message, 'extracted_text') ??
    stringField(message, 'preview') ??
    ''
  ).trim()
}

function isRequirementKey(key: string): key is RequirementKey {
  return requirementKeys.includes(key as RequirementKey)
}

async function agentMailFetch(
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown },
): Promise<unknown> {
  const baseUrl = (env.AGENTMAIL_BASE_URL || 'https://api.agentmail.to/v0').replace(/\/$/, '')
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${env.AGENTMAIL_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })

  if (!response.ok) {
    const body = (await response.text()).slice(0, 2_000)
    throw new Error(`AgentMail API error ${response.status}${body ? `: ${body}` : ''}`)
  }

  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? response.json() : null
}

async function getOrCreateInbox(ctx: ActionCtx): Promise<InboxSetting> {
  const existing: InboxSetting | null = await ctx.runQuery(internal.outreach.getInboxSetting, {})
  if (existing?.inboxId) return existing

  if (env.AGENTMAIL_INBOX_ID) {
    const configured = {
      inboxId: env.AGENTMAIL_INBOX_ID,
      email: env.AGENTMAIL_INBOX_EMAIL || '',
    }
    await ctx.runMutation(internal.outreach.saveInboxSetting, configured)
    return configured
  }

  const listed = asRecord(await agentMailFetch('/inboxes?limit=20', { method: 'GET' }))
  const listedInboxes = Array.isArray(listed?.inboxes)
    ? listed.inboxes.map(asRecord).filter((item): item is Record<string, unknown> => item !== null)
    : []
  const reusable =
    listedInboxes.find((item) => item.client_id === 'accessping') ??
    (listedInboxes.length === 1 ? listedInboxes[0] : null)

  if (reusable) {
    const inboxId = stringField(reusable, 'inbox_id')
    const email = stringField(reusable, 'email')
    if (inboxId && email) {
      await ctx.runMutation(internal.outreach.saveInboxSetting, { inboxId, email })
      return { inboxId, email }
    }
  }

  const created = await agentMailFetch('/inboxes', {
    method: 'POST',
    body: {
      display_name: 'AccessPing',
      client_id: 'accessping',
    },
  })
  const inboxId = stringField(created, 'inbox_id')
  const email = stringField(created, 'email')
  if (!inboxId || !email) {
    throw new Error('AgentMail created an inbox without an inbox ID or email address.')
  }

  await ctx.runMutation(internal.outreach.saveInboxSetting, { inboxId, email })
  return { inboxId, email }
}

export const ensureInbox = action({
  args: {},
  handler: async (ctx): Promise<InboxSetting> => getOrCreateInbox(ctx),
})

export const getInboxSetting = internalQuery({
  args: {},
  handler: async (ctx): Promise<InboxSetting | null> => {
    const setting = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'agentmailInbox'))
      .unique()
    if (!setting) return null
    return { inboxId: setting.value, email: setting.secondary ?? '' }
  },
})

export const saveInboxSetting = internalMutation({
  args: { inboxId: v.string(), email: v.string() },
  handler: async (ctx, { inboxId, email }): Promise<null> => {
    const existing = await ctx.db
      .query('settings')
      .withIndex('by_key', (q) => q.eq('key', 'agentmailInbox'))
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, { value: inboxId, secondary: email, updatedAt: Date.now() })
    } else {
      await ctx.db.insert('settings', {
        key: 'agentmailInbox',
        value: inboxId,
        secondary: email,
        updatedAt: Date.now(),
      })
    }
    return null
  },
})

export const getSendContext = internalQuery({
  args: { caseId: v.id('cases') },
  handler: async (
    ctx,
    { caseId },
  ): Promise<{ caseRecord: Doc<'cases'> | null; requirements: Doc<'requirements'>[] }> => {
    const caseRecord = await ctx.db.get(caseId)
    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)
    return { caseRecord, requirements }
  },
})

export const recordOutreach = internalMutation({
  args: {
    caseId: v.id('cases'),
    recipient: v.string(),
    inboxId: v.string(),
    threadId: v.string(),
    messageId: v.string(),
    questions: v.array(
      v.object({ key: v.string(), label: v.string(), question: v.string() }),
    ),
  },
  handler: async (ctx, args): Promise<Id<'outreach'>> => {
    const now = Date.now()
    return ctx.db.insert('outreach', {
      caseId: args.caseId,
      recipient: args.recipient,
      inboxId: args.inboxId,
      threadId: args.threadId,
      messageId: args.messageId,
      questions: args.questions,
      status: 'sent',
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const sendInquiry = action({
  args: { caseId: v.id('cases'), recipient: v.string() },
  handler: async (
    ctx,
    { caseId, recipient },
  ): Promise<{
    outreachId: Id<'outreach'>
    threadId: string
    messageId: string
    senderEmail: string
    questions: Question[]
  }> => {
    const cleanRecipient = recipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanRecipient)) {
      throw new Error('Enter a valid venue email address.')
    }

    const context: { caseRecord: Doc<'cases'> | null; requirements: Doc<'requirements'>[] } =
      await ctx.runQuery(internal.outreach.getSendContext, { caseId })

    if (!context.caseRecord || context.caseRecord.status !== 'ready') {
      throw new Error('Finish the venue research before sending follow-up questions.')
    }

    const unknown = context.requirements.flatMap((item) =>
      item.status === 'unknown' && isRequirementKey(item.key) ? [{ ...item, key: item.key }] : [],
    )
    const priorityUnknown = unknown.filter((item) => item.isPriority)
    const selected = priorityUnknown.length > 0 ? priorityUnknown : unknown
    if (selected.length === 0) {
      throw new Error('There are no unverified access details left to ask about.')
    }

    const questions: Question[] = selected.map((item) => ({
      key: item.key,
      label: item.label,
      question: questionBank[item.key],
    }))
    const venueName = context.caseRecord.venueName ?? 'your venue'
    const text = [
      'Hello,',
      '',
      `I’m checking a few accessibility details for ${venueName}. Could you please help confirm the following?`,
      '',
      ...questions.map((item, index) => `${index + 1}. ${item.question}`),
      '',
      'Thank you for your help.',
      'AccessPing',
    ].join('\n')

    const inbox = await getOrCreateInbox(ctx)
    const sent = await agentMailFetch(`/inboxes/${encodeURIComponent(inbox.inboxId)}/messages/send`, {
      method: 'POST',
      body: {
        to: cleanRecipient,
        subject: `Accessibility questions for ${venueName}`,
        text,
        labels: ['accessping', `accessping-case:${caseId}`],
      },
    })
    const messageId = stringField(sent, 'message_id')
    const threadId = stringField(sent, 'thread_id')
    if (!messageId || !threadId) {
      throw new Error('AgentMail accepted the request but returned no message or thread ID.')
    }

    const outreachId: Id<'outreach'> = await ctx.runMutation(internal.outreach.recordOutreach, {
      caseId,
      recipient: cleanRecipient,
      inboxId: inbox.inboxId,
      threadId,
      messageId,
      questions,
    })

    return {
      outreachId,
      threadId,
      messageId,
      senderEmail: inbox.email,
      questions,
    }
  },
})

export const getOutreachForSync = internalQuery({
  args: { outreachId: v.id('outreach') },
  handler: async (ctx, { outreachId }): Promise<Doc<'outreach'> | null> => ctx.db.get(outreachId),
})

export const recordSyncedReply = internalMutation({
  args: { outreachId: v.id('outreach'), replyText: v.string() },
  handler: async (ctx, { outreachId, replyText }): Promise<null> => {
    await ctx.db.patch(outreachId, {
      status: 'replied',
      replyText,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const syncLatestReply = action({
  args: { outreachId: v.id('outreach') },
  handler: async (
    ctx,
    { outreachId },
  ): Promise<{ found: boolean; processed: boolean }> => {
    const outreach: Doc<'outreach'> | null = await ctx.runQuery(
      internal.outreach.getOutreachForSync,
      { outreachId },
    )
    if (!outreach?.threadId) return { found: false, processed: false }

    const thread = asRecord(
      await agentMailFetch(
        `/inboxes/${encodeURIComponent(outreach.inboxId)}/threads/${encodeURIComponent(outreach.threadId)}`,
        { method: 'GET' },
      ),
    )
    const messages = Array.isArray(thread?.messages)
      ? thread.messages
          .map(asRecord)
          .filter((item): item is Record<string, unknown> => item !== null)
      : []

    const recipient = outreach.recipient.toLowerCase()
    const inbound = [...messages].reverse().find((message) => {
      const from = stringField(message, 'from')?.toLowerCase() ?? ''
      return from.includes(recipient) && messageText(message).length > 0
    })
    if (!inbound) return { found: false, processed: false }

    const text = messageText(inbound)
    await ctx.runMutation(internal.outreach.recordSyncedReply, { outreachId, replyText: text })
    const processed: null = await ctx.runAction(internal.outreach.processVenueReply, {
      caseId: outreach.caseId,
      threadId: outreach.threadId,
      text,
    })
    return { found: true, processed: processed === null }
  },
})

export const getReplyContext = internalQuery({
  args: { caseId: v.id('cases') },
  handler: async (ctx, { caseId }): Promise<Array<{ key: string; label: string }>> => {
    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)
    return requirements
      .filter((item) => item.status === 'unknown' && isRequirementKey(item.key))
      .map((item) => ({ key: item.key, label: item.label }))
  },
})

export const processVenueReply = internalAction({
  args: { caseId: v.id('cases'), threadId: v.string(), text: v.string() },
  handler: async (ctx, { caseId, text }): Promise<null> => {
    const context: Array<{ key: string; label: string }> = await ctx.runQuery(
      internal.outreach.getReplyContext,
      { caseId },
    )
    if (context.length === 0) return null

    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL || undefined,
    })
    const response = await openai.responses.parse({
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      instructions: REPLY_INSTRUCTIONS,
      input: `Currently unverified details:\n${context.map((item) => `- ${item.key}: ${item.label}`).join('\n')}\n\nVenue reply:\n${text.slice(0, 30_000)}`,
      text: { format: zodTextFormat(VenueReply, 'venue_reply_accessibility_updates') },
    })
    if (!response.output_parsed) return null

    const allowed = new Set(context.map((item) => item.key))
    const updates = response.output_parsed.updates
      .filter((item) => allowed.has(item.key))
      .map((item) => ({
        key: item.key,
        answer: item.answer.trim(),
        evidence: item.evidence.trim(),
      }))
      .filter((item) => item.answer.length > 0 && item.evidence.length > 0)

    if (updates.length > 0) {
      await ctx.runMutation(internal.outreach.applyVenueReply, { caseId, updates })
    }
    return null
  },
})

export const applyVenueReply = internalMutation({
  args: {
    caseId: v.id('cases'),
    updates: v.array(
      v.object({
        key: v.string(),
        answer: v.string(),
        evidence: v.string(),
      }),
    ),
  },
  handler: async (ctx, { caseId, updates }): Promise<null> => {
    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)
    const byKey = new Map(requirements.map((item) => [item.key, item]))
    const now = Date.now()

    for (const update of updates) {
      const requirement = byKey.get(update.key)
      if (!requirement || requirement.status !== 'unknown') continue
      await ctx.db.patch(requirement._id, {
        status: 'confirmed_venue',
        answer: update.answer,
        evidence: update.evidence,
        sourceUrl: undefined,
        updatedAt: now,
      })
    }
    return null
  },
})
