"use node";

import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { v } from 'convex/values'
import { env, internalAction } from './_generated/server'

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
Input contains one or more scraped pages delimited as "--- SOURCE: <url> ---".

Critical evidence rules:
1. Absence of evidence means UNKNOWN. Never infer that a feature does not exist because it is not mentioned.
2. Use confirmed_web only when the supplied sources explicitly support the claim.
3. Use conflicting when the supplied sources contain materially inconsistent information
   about the same detail — either within one page or across pages. Prefer cross-page
   conflicts when present; intra-page inconsistency also qualifies.
4. Evidence must be a short, faithful supporting excerpt or close paraphrase from the supplied sources.
5. sourceUrl must be one of the supplied SOURCE urls for confirmed_web or conflicting
   items (choose the page that actually contains the evidence), otherwise null.
6. Return exactly these six requirement keys once each: step_free_entrance, accessible_toilet, accessible_seating, parking_dropoff, hearing_support, quiet_space.
7. Do not provide legal compliance conclusions or a global accessibility score.
8. For UNKNOWN items, answer, evidence, and sourceUrl must all be null. Do not write explanatory "no evidence found" text into evidence.
`

function normalizeAnalysis(
  analysis: z.infer<typeof VenueAnalysis>,
  fallbackUrl: string,
  allowedUrls: string[],
) {
  const allowed = new Set(allowedUrls)
  return {
    venueName: analysis.venueName,
    requirements: analysis.requirements.map((requirement) => {
      if (requirement.status === 'unknown') {
        return {
          ...requirement,
          answer: null,
          evidence: null,
          sourceUrl: null,
        }
      }

      const answer = requirement.answer?.trim()
      const evidence = requirement.evidence?.trim()
      let sourceUrl = requirement.sourceUrl?.trim() || null
      if (sourceUrl && !allowed.has(sourceUrl)) {
        sourceUrl = fallbackUrl
      }
      if (!sourceUrl) sourceUrl = fallbackUrl

      if (!answer || !evidence) {
        return {
          ...requirement,
          status: 'unknown' as const,
          answer: null,
          evidence: null,
          sourceUrl: null,
        }
      }

      return {
        ...requirement,
        answer,
        evidence,
        sourceUrl,
      }
    }),
  }
}

export const parseVenueAccess = internalAction({
  args: {
    url: v.string(),
    markdown: v.string(),
    sourceUrls: v.optional(v.array(v.string())),
  },
  handler: async (_ctx, { url, markdown, sourceUrls }) => {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL || undefined,
    })
    const model = env.OPENAI_MODEL || 'gpt-5.6-luna'

    const response = await openai.responses.parse({
      model,
      reasoning: { effort: 'low' },
      instructions: SYSTEM_INSTRUCTIONS,
      input: `Source URL: ${url}\n\nSource content:\n${markdown}`,
      text: { format: zodTextFormat(VenueAnalysis, 'venue_accessibility_analysis') },
    })

    if (!response.output_parsed) {
      throw new Error('OpenAI did not return a structured accessibility analysis.')
    }

    const allowed = sourceUrls?.length ? sourceUrls : [url]
    const normalized = normalizeAnalysis(response.output_parsed, url, allowed)
    return {
      ...normalized,
      sources: allowed.map((source) => ({ url: source, chars: Math.min(markdown.length, 80_000) })),
      model,
    }
  },
})
