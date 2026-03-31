// ════════════════════════════════════════════════════════════
// Graph Webhook — Supabase Edge Function (Deno)
//
// Receives Microsoft Graph email notifications and forwards
// to Railway for processing. Kept minimal — Graph requires
// <3s response time.
//
// Deploy: supabase functions deploy graph-webhook
// Endpoint: https://<project>.supabase.co/functions/v1/graph-webhook
//
// Env vars: GRAPH_WEBHOOK_SECRET, RAILWAY_INTERNAL_URL
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GRAPH_WEBHOOK_SECRET = Deno.env.get('GRAPH_WEBHOOK_SECRET') || ''
const RAILWAY_URL = Deno.env.get('RAILWAY_INTERNAL_URL') || ''

serve(async (req: Request) => {
  // ── Handle Graph subscription validation ──
  // When creating a subscription, Graph sends a GET/POST with
  // ?validationToken=xxx — must echo it back as text/plain
  const url = new URL(req.url)
  const validationToken = url.searchParams.get('validationToken')
  if (validationToken) {
    return new Response(validationToken, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const body = await req.json()

    // Graph sends { value: [ { ...notification } ] }
    const notifications = body.value || []

    for (const notification of notifications) {
      // Validate clientState
      if (GRAPH_WEBHOOK_SECRET && notification.clientState !== GRAPH_WEBHOOK_SECRET) {
        console.warn('Invalid clientState on Graph notification — skipping')
        continue
      }

      // Forward to Railway for heavy processing
      if (RAILWAY_URL) {
        // Fire and forget — don't await (Graph needs <3s response)
        fetch(`${RAILWAY_URL}/api/email-notification`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resource: notification.resource,
            changeType: notification.changeType,
            tenantId: notification.tenantId,
            subscriptionId: notification.subscriptionId,
            resourceData: notification.resourceData,
          }),
        }).catch((err: Error) => {
          console.error('Failed to forward to Railway:', err.message)
        })
      }
    }

    // Return 202 Accepted immediately
    return new Response(null, { status: 202 })

  } catch (err) {
    console.error('Graph webhook error:', err)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
