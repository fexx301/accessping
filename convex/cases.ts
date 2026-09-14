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
  args: { url: v.string() },
  handler: async (ctx, { url }) => {
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
        updatedAt: now,
      })
    }

    return caseId
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
