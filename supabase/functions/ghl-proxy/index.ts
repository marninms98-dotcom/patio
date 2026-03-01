// ════════════════════════════════════════════════════════════
// SecureWorks — GHL Proxy Edge Function
//
// Secure proxy between the scoping tools and GoHighLevel API.
// The GHL API token stays server-side — never in client code.
//
// Endpoints (via query param ?action=):
//   GET  ?action=opportunities&pipeline=fencing|patio  — list opps from pipeline
//   GET  ?action=search&q=smith                        — search opps by contact name
//   POST ?action=link  { opportunityId, jobId }        — write scope link to opp notes
//
// Auth: Requires a valid Supabase JWT (logged-in user).
//
// Deploy:
//   supabase functions deploy ghl-proxy
//   supabase secrets set GHL_API_TOKEN="pit-..." GHL_LOCATION_ID="..."
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GHL_API_TOKEN = Deno.env.get('GHL_API_TOKEN') || ''
const GHL_LOCATION_ID = Deno.env.get('GHL_LOCATION_ID') || ''
const GHL_BASE = 'https://services.leadconnectorhq.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// Pipeline IDs
const PIPELINES: Record<string, { id: string; scopeStages: string[] }> = {
  fencing: {
    id: 'I9t8njpuR0Dm7B2NDcvI',
    scopeStages: ['Scope Scheduled', 'Scope Complete'],
  },
  patio: {
    id: 'OGZLpPPVWVarN94HL6af',
    scopeStages: ['Scope Booked', 'Scope Complete / Quote to be Sent'],
  },
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// Verify the Supabase JWT and return the user
async function verifyAuth(req: Request) {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new Error('No Authorization header')

  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error } = await sb.auth.getUser()
  if (error || !user) throw new Error('Invalid token')
  return user
}

// Call GHL API
async function ghlFetch(path: string, options: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${GHL_BASE}${path}`
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GHL_API_TOKEN}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GHL API ${res.status}: ${text}`)
  }
  return res.json()
}

// ── GET: List opportunities from a pipeline ──
async function getOpportunities(pipeline: string) {
  const pipelineConfig = PIPELINES[pipeline]
  if (!pipelineConfig) throw new Error('Invalid pipeline. Use "fencing" or "patio".')

  const data = await ghlFetch(
    `/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${pipelineConfig.id}&limit=100`,
    { method: 'GET' }
  )

  const opportunities = (data.opportunities || []).map((opp: any) => ({
    id: opp.id,
    name: opp.name || opp.contact?.name || 'Unknown',
    contactName: opp.contact?.name || opp.name || '',
    contactEmail: opp.contact?.email || '',
    contactPhone: opp.contact?.phone || '',
    stageName: opp.pipelineStageId ? opp.stageName || '' : '',
    status: opp.status,
    monetaryValue: opp.monetaryValue || 0,
    createdAt: opp.createdAt,
    updatedAt: opp.updatedAt,
    contactId: opp.contact?.id || '',
  }))

  return opportunities
}

// ── GET: Search opportunities by contact name ──
async function searchOpportunities(query: string) {
  const data = await ghlFetch(
    `/opportunities/search?location_id=${GHL_LOCATION_ID}&q=${encodeURIComponent(query)}&limit=50`,
    { method: 'GET' }
  )

  return (data.opportunities || []).map((opp: any) => ({
    id: opp.id,
    name: opp.name || opp.contact?.name || 'Unknown',
    contactName: opp.contact?.name || opp.name || '',
    contactEmail: opp.contact?.email || '',
    contactPhone: opp.contact?.phone || '',
    pipelineId: opp.pipelineId || '',
    stageName: opp.pipelineStageId ? opp.stageName || '' : '',
    status: opp.status,
    monetaryValue: opp.monetaryValue || 0,
    createdAt: opp.createdAt,
    contactId: opp.contact?.id || '',
  }))
}

// ── POST: Link scope to GHL opportunity ──
async function linkScopeToOpportunity(
  opportunityId: string,
  jobId: string,
  toolType: string
) {
  // Build the scope viewer URL
  const toolPath = toolType === 'fencing' ? 'fencing' : 'patio'
  const scopeUrl = `https://secureworkswa.com.au/tools/${toolPath}/?jobId=${jobId}`

  // Get existing opportunity to preserve existing notes
  const opp = await ghlFetch(
    `/opportunities/${opportunityId}`,
    { method: 'GET' }
  )

  const existingNotes = opp.notes || ''
  // Remove any previous scope link to avoid duplicates
  const cleanedNotes = existingNotes
    .replace(/\n?Scope: https:\/\/secureworkswa\.com\.au\/tools\/.*$/gm, '')
    .trim()

  const newNotes = cleanedNotes
    ? `${cleanedNotes}\n\nScope: ${scopeUrl}`
    : `Scope: ${scopeUrl}`

  // Update opportunity notes
  await ghlFetch(`/opportunities/${opportunityId}`, {
    method: 'PUT',
    body: JSON.stringify({ notes: newNotes }),
  })

  // Update the Supabase job with the GHL opportunity ID
  const sbService = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  await sbService
    .from('jobs')
    .update({ ghl_opportunity_id: opportunityId })
    .eq('id', jobId)

  // Log event
  await sbService.from('job_events').insert({
    job_id: jobId,
    event_type: 'ghl_linked',
    detail_json: { opportunity_id: opportunityId, scope_url: scopeUrl },
  })

  return { success: true, scopeUrl }
}

// ════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    // Verify auth
    await verifyAuth(req)

    const url = new URL(req.url)
    const action = url.searchParams.get('action')

    // ── Route by action ──
    if (req.method === 'GET' && action === 'opportunities') {
      const pipeline = url.searchParams.get('pipeline') || 'patio'
      const opps = await getOpportunities(pipeline)
      return jsonResponse({ opportunities: opps })
    }

    if (req.method === 'GET' && action === 'search') {
      const q = url.searchParams.get('q') || ''
      if (!q) return jsonResponse({ opportunities: [] })
      const opps = await searchOpportunities(q)
      return jsonResponse({ opportunities: opps })
    }

    if (req.method === 'POST' && action === 'link') {
      const body = await req.json()
      const { opportunityId, jobId, toolType } = body
      if (!opportunityId || !jobId) {
        return jsonResponse({ error: 'opportunityId and jobId are required' }, 400)
      }
      const result = await linkScopeToOpportunity(
        opportunityId,
        jobId,
        toolType || 'patio'
      )
      return jsonResponse(result)
    }

    return jsonResponse({ error: 'Unknown action. Use: opportunities, search, or link' }, 400)

  } catch (err) {
    console.error('GHL proxy error:', err)
    return jsonResponse({ error: (err as Error).message || 'Internal error' }, err.message?.includes('token') ? 401 : 500)
  }
})
