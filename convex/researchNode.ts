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

Critical evidence rules:
1. Absence of evidence means UNKNOWN. Never infer that a feature does not exist because it is not mentioned.
2. Use confirmed_web only when the supplied source explicitly supports the claim.
3. Use conflicting when the supplied source contains materially inconsistent information.
4. Evidence must be a short, faithful supporting excerpt or close paraphrase from the supplied source.
5. sourceUrl must be the supplied source URL for confirmed_web or conflicting items, otherwise null.
6. Return exactly these six requirement keys once each: step_free_entrance, accessible_toilet, accessible_seating, parking_dropoff, hearing_support, quiet_space.
7. Do not provide legal compliance conclusions or a global accessibility score.
8. For UNKNOWN items, answer, evidence, and sourceUrl must all be null. Do not write explanatory "no evidence found" text into evidence.
`

function normalizeAnalysis(analysis: z.infer<typeof VenueAnalysis>, sourceUrl: string) {
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
  args: { url: v.string(), markdown: v.string() },
  handler: async (_ctx, { url, markdown }) => {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL || undefined,
    })

    const response = await openai.responses.parse({
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      instructions: SYSTEM_INSTRUCTIONS,
      input: `Source URL: ${url}\n\nSource content:\n${markdown}`,
      text: { format: zodTextFormat(VenueAnalysis, 'venue_accessibility_analysis') },
    })

    if (!response.output_parsed) {
      throw new Error('OpenAI did not return a structured accessibility analysis.')
    }

    return normalizeAnalysis(response.output_parsed, url)
  },
})
