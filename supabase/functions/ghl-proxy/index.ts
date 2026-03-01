// ════════════════════════════════════════════════════════════
// SecureWorks — GHL Proxy Edge Function
//
// Secure proxy between the scoping tools and GoHighLevel API.
// The GHL API token stays server-side — never in client code.
//
// Endpoints (via query param ?action=):
//   GET  ?action=opportunities&pipeline=fencing|patio
//   GET  ?action=search&q=smith
//   GET  ?action=contact&contactId=xxx  — full contact details
//   POST ?action=link  { opportunityId, jobId, toolType, contact }
//   POST ?action=update_contact  { contactId, name, email, phone, address, suburb }
//
// Deploy:
//   supabase functions deploy ghl-proxy --no-verify-jwt
//   supabase secrets set GHL_API_TOKEN="pit-..." GHL_LOCATION_ID="..."
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GHL_API_TOKEN = Deno.env.get('GHL_API_TOKEN') || ''
const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID') || ''
const GHL_BASE = 'https://services.leadconnectorhq.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

const PIPELINES: Record<string, string> = {
  fencing: 'I9t8njpuR0Dm7B2NDcvI',
  patio: 'OGZLpPPVWVarN94HL6af',
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

async function ghl(path: string, init: RequestInit = {}) {
  const url = `${GHL_BASE}${path}`
  console.log(`[ghl-proxy] Calling: ${init.method || 'GET'} ${url}`)
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${GHL_API_TOKEN}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  console.log(`[ghl-proxy] Response: ${res.status} (${text.length} bytes)`)
  if (!res.ok) throw new Error(`GHL ${res.status}: ${text}`)
  return JSON.parse(text)
}

// ── Stage name cache (all pipelines loaded at once) ──
let stageCache: Record<string, Record<string, string>> = {}
let stageCacheLoaded = false

async function resolveStages(pipelineId: string) {
  if (!stageCacheLoaded) {
    try {
      const data = await ghl(`/opportunities/pipelines?locationId=${GHL_LOCATION_ID}`)
      for (const p of (data.pipelines || [])) {
        const map: Record<string, string> = {}
        for (const s of (p.stages || [])) {
          map[s.id] = s.name
        }
        stageCache[p.id] = map
      }
      stageCacheLoaded = true
    } catch (e) {
      console.log('[ghl-proxy] Stage fetch failed:', e)
    }
  }
  return stageCache[pipelineId] || {}
}

function mapOpp(opp: any, stages: Record<string, string>) {
  return {
    id: opp.id,
    name: opp.name || opp.contact?.name || 'Unknown',
    contactName: opp.contact?.name || opp.name || '',
    contactEmail: opp.contact?.email || '',
    contactPhone: opp.contact?.phone || '',
    stageName: stages[opp.pipelineStageId] || opp.status || '',
    status: opp.status,
    monetaryValue: opp.monetaryValue || 0,
    createdAt: opp.createdAt,
    contactId: opp.contact?.id || '',
  }
}

// ════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    console.log(`[ghl-proxy] action=${action} method=${req.method}`)

    // ── List opportunities ──
    if (action === 'opportunities') {
      const pipeline = url.searchParams.get('pipeline') || 'patio'
      const pipelineId = PIPELINES[pipeline]
      if (!pipelineId) return json({ error: 'Invalid pipeline' }, 400)

      const [stages, data] = await Promise.all([
        resolveStages(pipelineId),
        ghl(`/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${pipelineId}&limit=50`),
      ])
      const opps = (data.opportunities || []).map((o: any) => mapOpp(o, stages))
      return json({ opportunities: opps })
    }

    // ── Search ──
    if (action === 'search') {
      const q = url.searchParams.get('q') || ''
      if (!q) return json({ opportunities: [] })
      const data = await ghl(`/opportunities/search?location_id=${GHL_LOCATION_ID}&q=${encodeURIComponent(q)}&limit=50`)
      const opps = (data.opportunities || []).map((o: any) => mapOpp(o, {}))
      return json({ opportunities: opps })
    }

    // ── Get full contact details ──
    if (action === 'contact') {
      const contactId = url.searchParams.get('contactId') || ''
      if (!contactId) return json({ error: 'contactId required' }, 400)
      const data = await ghl(`/contacts/${contactId}`)
      const c = data.contact || data
      return json({
        contact: {
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.name || '',
          firstName: c.firstName || '',
          lastName: c.lastName || '',
          email: c.email || '',
          phone: c.phone || '',
          address: c.address1 || '',
          suburb: c.city || '',
          state: c.state || '',
          postcode: c.postalCode || '',
        }
      })
    }

    // ── Link scope to opportunity ──
    if (action === 'link' && req.method === 'POST') {
      const body = await req.json()
      const { opportunityId, jobId, toolType } = body
      if (!opportunityId || !jobId) return json({ error: 'opportunityId and jobId required' }, 400)

      const toolPath = toolType === 'fencing' ? 'fencing' : 'patio'
      const scopeUrl = `https://secureworkswa.com.au/tools/${toolPath}/?jobId=${jobId}`

      // Get existing notes, append scope link
      const opp = await ghl(`/opportunities/${opportunityId}`)
      const existing = (opp.notes || '').replace(/\n?Scope: https:\/\/secureworkswa\.com\.au\/tools\/.*$/gm, '').trim()
      const notes = existing ? `${existing}\n\nScope: ${scopeUrl}` : `Scope: ${scopeUrl}`
      await ghl(`/opportunities/${opportunityId}`, { method: 'PUT', body: JSON.stringify({ notes }) })

      // Update Supabase job
      const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      await sb.from('jobs').update({ ghl_opportunity_id: opportunityId }).eq('id', jobId)
      await sb.from('job_events').insert({ job_id: jobId, event_type: 'ghl_linked', detail_json: { opportunity_id: opportunityId, scope_url: scopeUrl } })

      return json({ success: true, scopeUrl })
    }

    // ── Update GHL contact with details from tool ──
    if (action === 'update_contact' && req.method === 'POST') {
      const body = await req.json()
      const { contactId, name, email, phone, address, suburb } = body
      if (!contactId) return json({ error: 'contactId required' }, 400)

      const update: Record<string, string> = {}
      if (name) {
        const parts = name.trim().split(/\s+/)
        update.firstName = parts[0]
        if (parts.length > 1) update.lastName = parts.slice(1).join(' ')
      }
      if (email) update.email = email
      if (phone) update.phone = phone
      if (address) update.address1 = address
      if (suburb) update.city = suburb

      await ghl(`/contacts/${contactId}`, { method: 'PUT', body: JSON.stringify(update) })
      return json({ success: true })
    }

    return json({ error: 'Unknown action' }, 400)

  } catch (err) {
    console.error('[ghl-proxy] ERROR:', err)
    return json({ error: (err as Error).message || 'Internal error' }, 500)
  }
})
