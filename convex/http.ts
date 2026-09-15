import { registerStaticRoutes } from '@convex-dev/static-hosting'
import { verifyAgentMailWebhook, WebhookVerificationError } from '@agentmail/convex'
import { httpRouter } from 'convex/server'
import { components, internal } from './_generated/api'
import { env, httpAction } from './_generated/server'
import { auth } from './auth'

const http = httpRouter()

auth.addHttpRoutes(http)

http.route({
  path: '/health',
  method: 'GET',
  handler: httpAction(async () => {
    return new Response(JSON.stringify({ ok: true, service: 'accessping' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }),
})

http.route({
  path: '/agentmail/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const secret = env.AGENTMAIL_WEBHOOK_SECRET
    if (!secret) {
      return new Response('AgentMail webhook is not configured.', { status: 503 })
    }

    const rawBody = await req.text()
    try {
      const event = verifyAgentMailWebhook(secret, rawBody, {
        'svix-id': req.headers.get('svix-id') ?? '',
        'svix-timestamp': req.headers.get('svix-timestamp') ?? '',
        'svix-signature': req.headers.get('svix-signature') ?? '',
      })
      await ctx.runMutation(internal.emailCallbacks.onAgentMailEvent, { event })
      return new Response(null, { status: 204 })
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        return new Response('invalid signature', { status: 401 })
      }
      throw error
    }
  }),
})

registerStaticRoutes(http, components.staticHosting)

export default http
