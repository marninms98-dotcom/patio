// ════════════════════════════════════════════════════════════
// SecureWorks — GHL Webhook Edge Function
//
// Receives form submissions from GoHighLevel and creates
// draft jobs in the database.
//
// Deploy: supabase functions deploy ghl-webhook
// GHL Setup: Point your form webhook to:
//   https://<project>.supabase.co/functions/v1/ghl-webhook
//
// Expected GHL payload (customize field mapping below):
// {
//   "contact_id": "abc123",
//   "full_name": "John Smith",
//   "phone": "0412345678",
//   "email": "john@example.com",
//   "customField.suburb": "Joondalup",
//   "customField.address": "123 Example St",
//   "customField.project_type": "patio",
//   "customField.timeframe": "1-3 months",
//   "customField.notes": "Want a 6x4 insulated patio"
// }
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Shared secret to verify requests come from GHL (set in Supabase dashboard)
const GHL_WEBHOOK_SECRET = Deno.env.get('GHL_WEBHOOK_SECRET') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Webhook-Secret',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify webhook secret if configured
  if (GHL_WEBHOOK_SECRET) {
    const secret = req.headers.get('X-Webhook-Secret') || req.headers.get('authorization')
    if (secret !== GHL_WEBHOOK_SECRET && secret !== `Bearer ${GHL_WEBHOOK_SECRET}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  try {
    const body = await req.json()

    // ── Map GHL fields to our schema ──
    // GHL sends data in various formats depending on form configuration.
    // This mapping handles the most common patterns.
    const mapped = mapGHLPayload(body)

    // Create Supabase client with service role (bypasses RLS)
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // Check if job already exists for this GHL contact
    if (mapped.ghl_contact_id) {
      const { data: existing } = await sb
        .from('jobs')
        .select('id')
        .eq('ghl_contact_id', mapped.ghl_contact_id)
        .limit(1)

      if (existing && existing.length > 0) {
        // Update existing job with latest details
        const { data, error } = await sb
          .from('jobs')
          .update({
            client_name: mapped.client_name,
            client_phone: mapped.client_phone,
            client_email: mapped.client_email,
            site_address: mapped.site_address,
            site_suburb: mapped.site_suburb,
            notes: mapped.notes,
          })
          .eq('id', existing[0].id)
          .select()
          .single()

        if (error) throw error

        // Log event
        await sb.from('job_events').insert({
          job_id: data.id,
          event_type: 'ghl_updated',
          detail_json: { source: 'ghl_webhook', raw: body },
        })

        return new Response(JSON.stringify({
          success: true,
          action: 'updated',
          job_id: data.id,
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    // Create new draft job
    const { data: job, error: jobError } = await sb
      .from('jobs')
      .insert({
        org_id: DEFAULT_ORG_ID,
        status: 'draft',
        type: mapped.type,
        client_name: mapped.client_name,
        client_phone: mapped.client_phone,
        client_email: mapped.client_email,
        site_address: mapped.site_address,
        site_suburb: mapped.site_suburb,
        notes: mapped.notes,
        ghl_contact_id: mapped.ghl_contact_id,
      })
      .select()
      .single()

    if (jobError) throw jobError

    // Log event
    await sb.from('job_events').insert({
      job_id: job.id,
      event_type: 'job_created',
      detail_json: {
        source: 'ghl_webhook',
        raw: body,
        timeframe: mapped.timeframe,
      },
    })

    return new Response(JSON.stringify({
      success: true,
      action: 'created',
      job_id: job.id,
    }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('GHL webhook error:', err)
    return new Response(JSON.stringify({
      error: err.message || 'Internal error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})

// ════════════════════════════════════════════════════════════
// GHL PAYLOAD MAPPING
// ════════════════════════════════════════════════════════════

interface MappedData {
  ghl_contact_id: string
  client_name: string
  client_phone: string
  client_email: string
  site_address: string
  site_suburb: string
  type: string
  timeframe: string
  notes: string
}

function mapGHLPayload(body: any): MappedData {
  // GHL sends data in multiple possible structures
  // Handle the common ones

  // Helper to find a value by checking multiple possible keys
  const find = (...keys: string[]): string => {
    for (const key of keys) {
      // Check top-level
      if (body[key]) return String(body[key])
      // Check nested customField prefix
      if (body[`customField.${key}`]) return String(body[`customField.${key}`])
      // Check customFields object
      if (body.customFields?.[key]) return String(body.customFields[key])
      // Check contact object
      if (body.contact?.[key]) return String(body.contact[key])
    }
    return ''
  }

  // Determine project type
  const projectTypeRaw = find('project_type', 'projectType', 'service', 'type').toLowerCase()
  let type = 'patio' // default
  if (projectTypeRaw.includes('fenc')) type = 'fencing'
  else if (projectTypeRaw.includes('combo') || projectTypeRaw.includes('both')) type = 'combo'
  else if (projectTypeRaw.includes('patio') || projectTypeRaw.includes('pergola') || projectTypeRaw.includes('carport')) type = 'patio'

  // Build notes from any extra info
  const timeframe = find('timeframe', 'timeline', 'when')
  const extraNotes = find('notes', 'message', 'description', 'additional_info')
  const notesParts: string[] = []
  if (timeframe) notesParts.push(`Timeframe: ${timeframe}`)
  if (projectTypeRaw && projectTypeRaw !== type) notesParts.push(`Project type: ${projectTypeRaw}`)
  if (extraNotes) notesParts.push(extraNotes)

  return {
    ghl_contact_id: find('contact_id', 'contactId', 'id'),
    client_name: find('full_name', 'fullName', 'name', 'firstName', 'first_name')
      + (find('lastName', 'last_name') ? ' ' + find('lastName', 'last_name') : ''),
    client_phone: find('phone', 'phoneNumber', 'mobile'),
    client_email: find('email', 'emailAddress'),
    site_address: find('address', 'street', 'site_address'),
    site_suburb: find('suburb', 'city', 'location', 'area'),
    type,
    timeframe,
    notes: notesParts.join('\n'),
  }
}
