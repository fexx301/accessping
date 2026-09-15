import { v } from 'convex/values'
import { FirecrawlClient } from '@firecrawl/firecrawl-convex'
import { internalAction, internalMutation, internalQuery } from './_generated/server'
import { components, internal } from './_generated/api'
import { diffRecheck, type RecheckChange } from './guards'

const firecrawl = new FirecrawlClient(components.firecrawl)

const RECHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CASES_PER_RUN = 3
const MAX_PAGES_PER_RECHECK = 5
const CHARS_PER_PAGE = 30_000
const MAX_COMBINED_CHARS = 80_000

export const dueCases = internalQuery({
  args: { now: v.number(), limit: v.number() },
  handler: async (ctx, { now, limit }) => {
    const candidates = await ctx.db
      .query('cases')
      .withIndex('by_createdAt')
      .order('asc')
      .take(100)
    return candidates
      .filter(
        (c) =>
          c.status === 'ready' &&
          c.recheckEnabled !== false &&
          (c.lastRecheckAt ?? c.createdAt) < now - RECHECK_INTERVAL_MS,
      )
      .slice(0, limit)
      .map((c) => ({
        caseId: c._id,
        url: c.url,
        venueName: c.venueName,
        ownerEmail: c.ownerEmail,
        sources: (c.researchSources ?? []).map((s) => s.url).slice(0, MAX_PAGES_PER_RECHECK),
      }))
  },
})

export const applyRecheck = internalMutation({
  args: {
    caseId: v.id('cases'),
    fresh: v.array(
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
    sources: v.array(v.object({ url: v.string(), chars: v.number() })),
    model: v.optional(v.string()),
  },
  handler: async (ctx, { caseId, fresh, sources, model }): Promise<{ changes: RecheckChange[] }> => {
    const now = Date.now()
    const existing = await ctx.db
      .query('requirements')
      .withIndex('by_caseId', (q) => q.eq('caseId', caseId))
      .take(20)
    const changes = diffRecheck(
      existing.map((r) => ({
        key: r.key,
        label: r.label,
        status: r.status,
        answer: r.answer,
        evidence: r.evidence,
        sourceUrl: r.sourceUrl,
      })),
      fresh,
    )
    const byKey = new Map(existing.map((item) => [item.key, item]))

    for (const change of changes) {
      const row = byKey.get(change.key)
      if (!row || row.status === 'confirmed_venue') continue
      if (change.kind === 'confirmed' || change.kind === 'changed') {
        await ctx.db.patch(row._id, {
          status: change.kind === 'confirmed' ? 'confirmed_web' : 'conflicting',
          answer: change.answer,
          evidence:
            change.kind === 'changed' && row.evidence
              ? `Earlier: ${row.evidence} | Latest review: ${change.evidence}`
              : change.evidence,
          sourceUrl: change.sourceUrl ?? row.sourceUrl,
          updatedAt: now,
        })
      } else {
        // Evidence vanished from the source: surface as conflicting so a
        // human re-checks instead of silently dropping a confirmed fact.
        await ctx.db.patch(row._id, {
          status: 'conflicting',
          answer: `This detail was previously confirmed but the latest review found no supporting statement.${row.answer ? ` Earlier answer: ${row.answer}` : ''}`,
          evidence: row.evidence,
          updatedAt: now,
        })
      }
    }

    await ctx.db.patch(caseId, {
      lastRecheckAt: now,
      researchSources: sources,
      researchModel: model,
      updatedAt: now,
    })
    return { changes }
  },
})

export const markRechecked = internalMutation({
  args: { caseId: v.id('cases') },
  handler: async (ctx, { caseId }) => {
    await ctx.db.patch(caseId, { lastRecheckAt: Date.now(), updatedAt: Date.now() })
  },
})

function changeSummary(changes: RecheckChange[]): string {
  return changes
    .map((c) => {
      if (c.kind === 'confirmed') return `✓ ${c.label} is now confirmed: ${c.answer}`
      if (c.kind === 'vanished')
        return `⚠ ${c.label} lost its source evidence and needs review${c.priorAnswer ? ` (was: ${c.priorAnswer})` : ''}`
      return `⚠ ${c.label} changed and needs review: ${c.answer}`
    })
    .join('\n')
}

export const runBatch = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; alerted: number }> => {
    const due = await ctx.runQuery(internal.recheck.dueCases, {
      now: Date.now(),
      limit: MAX_CASES_PER_RUN,
    })
    let alerted = 0
    for (const item of due) {
      try {
        const urls = item.sources.length > 0 ? item.sources : [item.url]
        const pages: Array<{ url: string; markdown: string }> = []
        for (const pageUrl of urls.slice(0, MAX_PAGES_PER_RECHECK)) {
          try {
            const page = await firecrawl.scrape(ctx, pageUrl, {
              formats: ['markdown'],
              onlyMainContent: true,
              maxAge: 60 * 60 * 1000,
            })
            const markdown = page.markdown?.trim()
            if (markdown) pages.push({ url: pageUrl, markdown: markdown.slice(0, CHARS_PER_PAGE) })
          } catch (error) {
            console.warn('Recheck scrape skipped for', pageUrl, error)
          }
        }
        if (pages.length === 0) {
          await ctx.runMutation(internal.recheck.markRechecked, { caseId: item.caseId })
          continue
        }
        const combined = pages
          .map((p) => `--- SOURCE: ${p.url} ---\n${p.markdown}`)
          .join('\n\n')
          .slice(0, MAX_COMBINED_CHARS)
        const analysis = await ctx.runAction(internal.researchNode.parseVenueAccess, {
          url: item.url,
          markdown: combined,
          sourceUrls: pages.map((p) => p.url),
        })
        const { changes } = await ctx.runMutation(internal.recheck.applyRecheck, {
          caseId: item.caseId,
          fresh: analysis.requirements,
          sources: analysis.sources ?? pages.map((p) => ({ url: p.url, chars: p.markdown.length })),
          model: analysis.model,
        })
        if (changes.length > 0 && item.ownerEmail) {
          await ctx.runAction(internal.outreach.sendOwnerEmail, {
            to: item.ownerEmail,
            subject: `AccessPing re-check: ${changes.length} change${changes.length === 1 ? '' : 's'} for ${item.venueName ?? 'your venue'}`,
            text: [
              `AccessPing re-checked ${item.url} and found ${changes.length} change${changes.length === 1 ? '' : 's'} since the last review:`,
              '',
              changeSummary(changes),
            ].join('\n'),
            label: `accessping-recheck:${item.caseId}`,
          })
          alerted += 1
        }
      } catch (error) {
        console.warn('Recheck failed for case', item.caseId, error)
        await ctx.runMutation(internal.recheck.markRechecked, { caseId: item.caseId })
      }
    }
    return { checked: due.length, alerted }
  },
})
