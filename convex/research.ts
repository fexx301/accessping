import { FirecrawlClient } from '@firecrawl/firecrawl-convex'
import { v } from 'convex/values'
import { action, internalMutation } from './_generated/server'
import { components, internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { MAX_RESEARCH_ATTEMPTS, rankAccessibility, sameOriginOnly } from './guards'

const firecrawl = new FirecrawlClient(components.firecrawl)

const MAX_ATTEMPTS = MAX_RESEARCH_ATTEMPTS
const MAX_PAGES = 5
const CHARS_PER_PAGE = 30_000
const MAX_COMBINED_CHARS = 80_000

export const analyzeVenue = action({
  args: { caseId: v.id('cases'), url: v.string(), ownerToken: v.optional(v.string()) },
  handler: async (ctx, { caseId, url, ownerToken }): Promise<{ caseId: Id<'cases'> }> => {
    try {
      await ctx.runMutation(internal.research.markResearching, { caseId, ownerToken })

      let origin: string
      try {
        origin = new URL(url).origin
      } catch {
        throw new Error('Use a complete http:// or https:// venue or event URL.')
      }

      // Phase 1 — scrape the submitted page with link discovery on.
      let mainMarkdown = ''
      let discovered: string[] = []
      try {
        const main = await firecrawl.scrape(ctx, url, {
          formats: ['markdown', 'links'],
          onlyMainContent: true,
          maxAge: 60 * 60 * 1000,
        })
        mainMarkdown = main.markdown?.trim() ?? ''
        if (Array.isArray(main.links)) {
          discovered.push(...main.links.filter((l): l is string => typeof l === 'string'))
        }
      } catch (error) {
        console.warn('Firecrawl main scrape failed for', url, error)
      }

      // Phase 2 — map the site to find accessibility pages the entry URL
      // does not link to (best-effort; never fails the check).
      try {
        const mapped = await firecrawl.map(ctx, url, {
          sitemap: 'include',
          includeSubdomains: false,
          limit: 25,
        })
        for (const link of mapped.links ?? []) {
          if (link?.url) discovered.push(link.url)
        }
      } catch (error) {
        console.warn('Firecrawl map skipped for', url, error)
      }

      // Phase 3 — rank same-origin candidates by accessibility signal and
      // scrape the best ones alongside the submitted page.
      const hardcoded = [`${origin}/accessibility`, `${origin}/access`]
      const candidates = sameOriginOnly([...hardcoded, ...discovered], origin).filter(
        (candidate) => candidate !== url,
      )
      const ranked = candidates
        .map((candidate) => ({ candidate, score: rankAccessibility(candidate) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_PAGES - 1)
        .map((item) => item.candidate)

      const pages: Array<{ url: string; markdown: string }> = []
      if (mainMarkdown) {
        pages.push({ url, markdown: mainMarkdown.slice(0, CHARS_PER_PAGE) })
      }
      for (const pageUrl of ranked) {
        if (pages.length >= MAX_PAGES) break
        try {
          const page = await firecrawl.scrape(ctx, pageUrl, {
            formats: ['markdown'],
            onlyMainContent: true,
            maxAge: 60 * 60 * 1000,
          })
          const markdown = page.markdown?.trim()
          if (markdown) {
            pages.push({ url: pageUrl, markdown: markdown.slice(0, CHARS_PER_PAGE) })
          }
        } catch (error) {
          console.warn('Firecrawl follow-up scrape skipped for', pageUrl, error)
        }
      }

      // Fallback: if discovery found nothing usable, scrape the hardcoded
      // candidates directly so /accessibility-style pages still get a chance.
      if (pages.length === 0) {
        for (const pageUrl of sameOriginOnly([url, ...hardcoded], origin)) {
          if (pages.length >= MAX_PAGES) break
          try {
            const page = await firecrawl.scrape(ctx, pageUrl, {
              formats: ['markdown'],
              onlyMainContent: true,
              maxAge: 60 * 60 * 1000,
            })
            const markdown = page.markdown?.trim()
            if (markdown) {
              pages.push({ url: pageUrl, markdown: markdown.slice(0, CHARS_PER_PAGE) })
            }
          } catch (error) {
            console.warn('Firecrawl fallback scrape skipped for', pageUrl, error)
          }
        }
      }

      if (pages.length === 0) throw new Error('Firecrawl returned no readable page content.')

      const combined = pages
        .map((p) => `--- SOURCE: ${p.url} ---\n${p.markdown}`)
        .join('\n\n')
        .slice(0, MAX_COMBINED_CHARS)

      const normalizedAnalysis = await ctx.runAction(internal.researchNode.parseVenueAccess, {
        url,
        markdown: combined,
        sourceUrls: pages.map((p) => p.url),
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
  args: { caseId: v.id('cases'), ownerToken: v.optional(v.string()) },
  handler: async (ctx, { caseId, ownerToken }) => {
    const record = await ctx.db.get(caseId)
    if (!record) throw new Error('Case not found.')
    const identity = await ctx.auth.getUserIdentity()
    const userId = identity?.subject ?? null
    const tokenOk = !record.ownerToken || record.ownerToken === ownerToken
    const authOk = !!userId && !!record.userId && record.userId === userId
    if (!tokenOk && !authOk) {
      throw new Error('This check belongs to another account or browser session.')
    }
    if ((record.attemptCount ?? 0) >= MAX_ATTEMPTS) {
      throw new Error('This case has been researched too many times.')
    }
    await ctx.db.patch(caseId, {
      status: 'researching',
      error: undefined,
      attemptCount: (record.attemptCount ?? 0) + 1,
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
      sources: v.optional(v.array(v.object({ url: v.string(), chars: v.number() }))),
      model: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { caseId, analysis }) => {
    const now = Date.now()
    // Preserve row identity: patch existing rows by key instead of
    // delete+reinsert so realtime keys stay stable.
    const existing = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)
    const byKey = new Map(existing.map((item) => [item.key, item]))

    for (const requirement of analysis.requirements) {
      const prior = byKey.get(requirement.key)
      const row = {
        caseId,
        key: requirement.key,
        label: requirement.label,
        status: requirement.status,
        isPriority: prior?.isPriority ?? false,
        answer: requirement.answer ?? undefined,
        evidence: requirement.evidence ?? undefined,
        sourceUrl: requirement.sourceUrl ?? undefined,
        updatedAt: now,
      }
      if (prior) {
        await ctx.db.patch(prior._id, row)
      } else {
        await ctx.db.insert('requirements', row)
      }
    }

    await ctx.db.patch(caseId, {
      venueName: analysis.venueName ?? undefined,
      status: 'ready',
      error: undefined,
      researchSources: analysis.sources,
      researchModel: analysis.model,
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
