import { FirecrawlClient } from '@firecrawl/firecrawl-convex'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { v } from 'convex/values'
import { action, env, internalMutation } from './_generated/server'
import { components, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const firecrawl = new FirecrawlClient(components.firecrawl)

const Requirement = z.object({
  key: z.enum([
    'step_free_entrance',
    'accessible_toilet',
    'accessible_seating',
    'parking_dropoff',
    'hearing_support',
    'quiet_space',
  ]),
  label: z.string(),
  status: z.enum(['confirmed_web', 'unknown', 'conflicting']),
  answer: z.string().nullable(),
  evidence: z.string().nullable(),
  sourceUrl: z.string().nullable(),
})

const VenueAnalysis = z.object({
  venueName: z.string().nullable(),
  requirements: z.array(Requirement).length(6),
})

const SYSTEM_INSTRUCTIONS = `
You extract accessibility facts from venue or event source material.

Critical evidence rules:
1. Absence of evidence means UNKNOWN. Never infer that a feature does not exist because it is not mentioned.
2. Use confirmed_web only when the supplied source explicitly supports the claim.
3. Use conflicting when the supplied source contains materially inconsistent information.
4. Evidence must be a short, faithful supporting excerpt or close paraphrase from the supplied source.
5. sourceUrl must be the supplied source URL for confirmed_web or conflicting items, otherwise null.
6. Return exactly these six requirement keys once each: step_free_entrance, accessible_toilet, accessible_seating, parking_dropoff, hearing_support, quiet_space.
7. Do not provide legal compliance conclusions or a global accessibility score.
`

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

      const openai = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        baseURL: env.OPENAI_BASE_URL || undefined,
      })

      const response = await openai.responses.parse({
        model: env.OPENAI_MODEL || 'gpt-5.6-luna',
        instructions: SYSTEM_INSTRUCTIONS,
        input: `Source URL: ${url}\n\nSource content:\n${markdown.slice(0, 80_000)}`,
        text: { format: zodTextFormat(VenueAnalysis, 'venue_accessibility_analysis') },
      })

      if (!response.output_parsed) {
        throw new Error('OpenAI did not return a structured accessibility analysis.')
      }

      await ctx.runMutation(internal.research.saveAnalysis, {
        caseId,
        analysis: response.output_parsed,
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

    await Promise.all(existing.map((item) => ctx.db.delete(item._id)))

    for (const requirement of analysis.requirements) {
      await ctx.db.insert('requirements', {
        caseId,
        key: requirement.key,
        label: requirement.label,
        status: requirement.status,
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
