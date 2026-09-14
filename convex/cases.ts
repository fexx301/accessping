import { v } from 'convex/values'
import { mutation, query } from './_generated/server'

const requirementTemplate = [
  ['step_free_entrance', 'Step-free entrance'],
  ['accessible_toilet', 'Accessible toilet'],
  ['accessible_seating', 'Accessible seating'],
  ['parking_dropoff', 'Parking / drop-off'],
  ['hearing_support', 'Hearing / communication support'],
  ['quiet_space', 'Quiet / sensory space'],
] as const

export const create = mutation({
  args: { url: v.string(), priorityKeys: v.array(v.string()) },
  handler: async (ctx, { url, priorityKeys }) => {
    const now = Date.now()
    const caseId = await ctx.db.insert('cases', {
      url,
      status: 'queued',
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

    return caseId
  },
})

export const setPriority = mutation({
  args: {
    caseId: v.id('cases'),
    key: v.string(),
    isPriority: v.boolean(),
  },
  handler: async (ctx, { caseId, key, isPriority }) => {
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
  args: { caseId: v.id('cases') },
  handler: async (ctx, { caseId }) => {
    const caseRecord = await ctx.db.get(caseId)
    if (!caseRecord) return null

    const requirements = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)

    const outreach = await ctx.db
      .query('outreach')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .order('desc')
      .first()

    return { case: caseRecord, requirements, outreach }
  },
})
