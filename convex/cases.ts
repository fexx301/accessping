import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
import { MAX_CASES_PER_HOUR, normalizeUrl } from './guards'

const requirementTemplate = [
  ['step_free_entrance', 'Step-free entrance'],
  ['accessible_toilet', 'Accessible toilet'],
  ['accessible_seating', 'Accessible seating'],
  ['parking_dropoff', 'Parking / drop-off'],
  ['hearing_support', 'Hearing / communication support'],
  ['quiet_space', 'Quiet / sensory space'],
] as const

function assertValidUrl(url: string) {
  return normalizeUrl(url)
}

async function callerUserId(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity()
  return identity?.subject ?? null
}

type OwnedCase = { ownerToken?: string; userId?: string } | null

function hasAccess(caseRecord: OwnedCase, userId: string | null, ownerToken?: string) {
  if (!caseRecord) return false
  // Authenticated owner always has access.
  if (userId && caseRecord.userId && caseRecord.userId === userId) return true
  // Browser-session token grants access (covers anonymous + legacy flows).
  if (caseRecord.ownerToken && caseRecord.ownerToken === ownerToken) return true
  // Legacy open cases with neither marker stay accessible.
  if (!caseRecord.ownerToken && !caseRecord.userId) return true
  return false
}

function assertOwner(
  caseRecord: OwnedCase,
  userId: string | null,
  ownerToken?: string,
) {
  if (!caseRecord) throw new Error('Case not found.')
  if (!hasAccess(caseRecord, userId, ownerToken)) {
    throw new Error('This check belongs to another account or browser session.')
  }
}

export const create = mutation({
  args: {
    url: v.string(),
    priorityKeys: v.array(v.string()),
    ownerToken: v.string(),
  },
  handler: async (ctx, { url, priorityKeys, ownerToken }) => {
    const cleanUrl = assertValidUrl(url)
    if (ownerToken.trim().length < 16) {
      throw new Error('Missing case ownership token. Reload and try again.')
    }

    // Light global abuse brake: at most 60 cases created in the last hour.
    // This does not replace auth, but prevents runaway Firecrawl/OpenAI spend
    // from a single open endpoint.
    const hourAgo = Date.now() - 60 * 60 * 1000
    const recent = await ctx.db
      .query('cases')
      .withIndex('by_createdAt', (q) => q.gte('createdAt', hourAgo))
      .take(MAX_CASES_PER_HOUR + 1)
    if (recent.length >= MAX_CASES_PER_HOUR) {
      throw new Error('Too many checks right now. Please try again in a little while.')
    }

    const now = Date.now()
    const userId = await callerUserId(ctx)
    const caseId = await ctx.db.insert('cases', {
      url: cleanUrl,
      status: 'queued',
      ownerToken,
      userId: userId ?? undefined,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    })

    for (const [key, label] of requirementTemplate) {
      await ctx.db.insert('requirements', {
        caseId,
        key,
        label,
        status: 'unknown',
        isPriority: priorityKeys.includes(key),
        updatedAt: now,
      })
    }

    return { caseId, ownerToken }
  },
})

export const setPriority = mutation({
  args: {
    caseId: v.id('cases'),
    key: v.string(),
    isPriority: v.boolean(),
    ownerToken: v.optional(v.string()),
  },
  handler: async (ctx, { caseId, key, isPriority, ownerToken }) => {
    const caseRecord = await ctx.db.get(caseId)
    assertOwner(caseRecord, await callerUserId(ctx), ownerToken)

    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)

    const requirement = requirements.find((item) => item.key === key)
    if (!requirement) throw new Error('Requirement not found for this case.')

    await ctx.db.patch(requirement._id, {
      isPriority,
      updatedAt: Date.now(),
    })

    return null
  },
})

export const getBundle = query({
  args: { caseId: v.id('cases'), ownerToken: v.optional(v.string()) },
  handler: async (ctx, { caseId, ownerToken }) => {
    const caseRecord = await ctx.db.get(caseId)
    if (!caseRecord) return null
    // Enforce ownership on read: authenticated owner, session token, or legacy open.
    if (!hasAccess(caseRecord, await callerUserId(ctx), ownerToken)) return null

    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)

    const outreach = await ctx.db
      .query('outreach')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .order('desc')
      .first()

    const outreachCount = (
      await ctx.db
        .query('outreach')
        .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
        .take(10)
    ).length

    return { case: caseRecord, requirements, outreach, outreachCount }
  },
})

// History summaries for cases owned by this account or browser. The client
// passes (caseId, ownerToken) pairs stored in localStorage; each pair is
// verified, and authenticated owners also match via their user id.
export const getHistory = query({
  args: {
    refs: v.array(v.object({ caseId: v.id('cases'), ownerToken: v.string() })),
  },
  handler: async (ctx, { refs }) => {
    const userId = await callerUserId(ctx)
    const limited = refs.slice(0, 20)
    const out: Array<{
      caseId: string
      url: string
      venueName?: string
      status: string
      createdAt: number
      confirmed: number
      unknown: number
    }> = []
    for (const ref of limited) {
      const caseRecord = await ctx.db.get(ref.caseId)
      if (!caseRecord) continue
      if (!hasAccess(caseRecord, userId, ref.ownerToken)) continue
      const requirements = await ctx.db
        .query('requirements')
        .withIndex('by_caseId', (q) => q.eq('caseId', ref.caseId))
        .take(20)
      out.push({
        caseId: ref.caseId,
        url: caseRecord.url,
        venueName: caseRecord.venueName,
        status: caseRecord.status,
        createdAt: caseRecord.createdAt,
        confirmed: requirements.filter(
          (r) => r.status === 'confirmed_web' || r.status === 'confirmed_venue',
        ).length,
        unknown: requirements.filter((r) => r.status === 'unknown').length,
      })
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  },
})

export const resetForRetry = mutation({
  args: { caseId: v.id('cases'), ownerToken: v.optional(v.string()) },
  handler: async (ctx, { caseId, ownerToken }) => {
    const caseRecord = await ctx.db.get(caseId)
    assertOwner(caseRecord, await callerUserId(ctx), ownerToken)
    if (!caseRecord) throw new Error('Case not found.')
    if (caseRecord.status !== 'failed') {
      throw new Error('Only stopped research can be retried.')
    }
    if ((caseRecord.attemptCount ?? 0) >= 3) {
      throw new Error('This case has been retried too many times. Start a new check instead.')
    }
    await ctx.db.patch(caseId, {
      status: 'queued',
      error: undefined,
      updatedAt: Date.now(),
    })
    return null
  },
})

export const remove = mutation({
  args: { caseId: v.id('cases'), ownerToken: v.optional(v.string()) },
  handler: async (ctx, { caseId, ownerToken }) => {
    const caseRecord = await ctx.db.get(caseId)
    assertOwner(caseRecord, await callerUserId(ctx), ownerToken)
    if (!caseRecord) throw new Error('Case not found.')

    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)
    for (const r of requirements) await ctx.db.delete(r._id)

    const threads = await ctx.db
      .query('outreach')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(10)
    for (const t of threads) await ctx.db.delete(t._id)

    await ctx.db.delete(caseId)
    return null
  },
})

// Authenticated owner's cases across browsers, newest first.
export const myCases = query({
  args: {},
  handler: async (ctx) => {
    const userId = await callerUserId(ctx)
    if (!userId) return []
    const owned = await ctx.db
      .query('cases')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .order('desc')
      .take(20)
    return owned.map((c) => ({
      caseId: c._id,
      url: c.url,
      venueName: c.venueName,
      status: c.status,
      createdAt: c.createdAt,
    }))
  },
})

// Retention hygiene: delete failed/queued cases older than 30 days and their
// children. Intended for a scheduled cron; safe to run manually.
export const purgeOld = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
    const old = await ctx.db
      .query('cases')
      .withIndex('by_createdAt', (q) => q.lt('createdAt', cutoff))
      .take(50)
    let deleted = 0
    for (const c of old) {
      if (c.status !== 'failed' && c.status !== 'queued') continue
      const reqs = await ctx.db
        .query('requirements')
        .withIndex('by_caseId', (q) => q.eq('caseId', c._id))
        .take(20)
      for (const r of reqs) await ctx.db.delete(r._id)
      const threads = await ctx.db
        .query('outreach')
        .withIndex('by_caseId', (q) => q.eq('caseId', c._id))
        .take(10)
      for (const t of threads) await ctx.db.delete(t._id)
      await ctx.db.delete(c._id)
      deleted += 1
    }
    return { deleted }
  },
})
