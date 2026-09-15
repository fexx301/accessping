"use node";

import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { v } from 'convex/values'
import { env, internalAction } from './_generated/server'

const requirementKeys = [
  'step_free_entrance',
  'accessible_toilet',
  'accessible_seating',
  'parking_dropoff',
  'hearing_support',
  'quiet_space',
] as const

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
1. Only return an update when the reply explicitly answers that access detail — including an explicit negative ("we do not have...").
2. Do not infer an answer from silence, tone, or general statements.
3. answer should be a concise user-facing summary of what the venue confirmed, including a negative answer if the venue explicitly says a feature is unavailable.
4. evidence should be a short faithful excerpt or close paraphrase from the venue reply.
5. Do not add keys that were not listed as currently needing review.
6. If the reply answers nothing relevant, return an empty updates array.
`

export const extractVenueReply = internalAction({
  args: {
    context: v.array(
      v.object({ key: v.string(), label: v.string(), status: v.optional(v.string()) }),
    ),
    text: v.string(),
  },
  handler: async (_ctx, { context, text }) => {
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
      baseURL: env.OPENAI_BASE_URL || undefined,
    })

    const response = await openai.responses.parse({
      model: env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      instructions: REPLY_INSTRUCTIONS,
      input: `Details needing review:\n${context.map((item) => `- ${item.key}: ${item.label}${item.status ? ` (current: ${item.status})` : ''}`).join('\n')}\n\nVenue reply:\n${text}`,
      text: { format: zodTextFormat(VenueReply, 'venue_reply_accessibility_updates') },
    })

    return response.output_parsed ?? { updates: [] }
  },
})
