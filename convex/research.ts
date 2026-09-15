import { FirecrawlClient } from '@firecrawl/firecrawl-convex'
import { v } from 'convex/values'
import { action, internalMutation } from './_generated/server'
import { components, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const firecrawl = new FirecrawlClient(components.firecrawl)

export const analyzeVenue = action({
  args: { caseId: v.id('cases'), url: v.string() },
  handler: async (ctx, { caseId, url }): Promise<{ caseId: Id<'cases'> }> => {
    try {
      await ctx.runMutation(internal.research.markResearching, { caseId })

      const page = await firecrawl.scrape(ctx, url, {
        formats: ['markdown'],
        onlyMainContent: true,
        maxAge: 60 * 60 * 1000,
      })

      const markdown = page.markdown?.trim()
      if (!markdown) throw new Error('Firecrawl returned no readable page content.')

      const normalizedAnalysis = await ctx.runAction(internal.researchNode.parseVenueAccess, {
        url,
        markdown: markdown.slice(0, 80_000),
      })

      await ctx.runMutation(internal.research.saveAnalysis, {
        caseId,
        analysis: normalizedAnalysis,
      })

      return { caseId }
    } catch (error) {
      await ctx.runMutation(internal.research.markFailed, {
        caseId,
        message: error instanceof Error ? error.message : 'Venue analysis failed.',
      })
      throw error
    }
  },
})

export const markResearching = internalMutation({
  args: { caseId: v.id('cases') },
  handler: async (ctx, { caseId }) => {
    await ctx.db.patch(caseId, {
      status: 'researching',
      error: undefined,
      updatedAt: Date.now(),
    })
  },
})

export const saveAnalysis = internalMutation({
  args: {
    caseId: v.id('cases'),
    analysis: v.object({
      venueName: v.union(v.string(), v.null()),
      requirements: v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          status: v.union(
            v.literal('confirmed_web'),
            v.literal('unknown'),
            v.literal('conflicting'),
          ),
          answer: v.union(v.string(), v.null()),
          evidence: v.union(v.string(), v.null()),
          sourceUrl: v.union(v.string(), v.null()),
        }),
      ),
    }),
  },
  handler: async (ctx, { caseId, analysis }) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)

    const priorities = new Map(existing.map((item) => [item.key, item.isPriority ?? false]))

    await Promise.all(existing.map((item) => ctx.db.delete(item._id)))

    for (const requirement of analysis.requirements) {
      await ctx.db.insert('requirements', {
        caseId,
        key: requirement.key,
        label: requirement.label,
        status: requirement.status,
        isPriority: priorities.get(requirement.key) ?? false,
        answer: requirement.answer ?? undefined,
        evidence: requirement.evidence ?? undefined,
        sourceUrl: requirement.sourceUrl ?? undefined,
        updatedAt: now,
      })
    }

    await ctx.db.patch(caseId, {
      venueName: analysis.venueName ?? undefined,
      status: 'ready',
      error: undefined,
      updatedAt: now,
    })
  },
})

export const markFailed = internalMutation({
  args: { caseId: v.id('cases'), message: v.string() },
  handler: async (ctx, { caseId, message }) => {
    await ctx.db.patch(caseId, {
      status: 'failed',
      error: message,
      updatedAt: Date.now(),
    })
  },
})
