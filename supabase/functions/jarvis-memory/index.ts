// ════════════════════════════════════════════════════════════
// JARVIS — Memory Edge Function
//
// CRUD operations for the memory system:
// - Entity profiles (find/create/update/search)
// - Observations (log, retrieve, supersede)
// - Corrections (log, retrieve, apply patterns)
// - Commitments (create, complete, list overdue)
// - Bulk memory recall for context injection
//
// Deploy: supabase functions deploy jarvis-memory
// Endpoint: POST /functions/v1/jarvis-memory
//
// Payload:
// {
//   "action": "log_observation" | "recall_entity" | "search" | ...,
//   "params": { ... }
// }
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

// ────────────────────────────────────────────────────────────
// ACTION HANDLERS
// ────────────────────────────────────────────────────────────

type ActionHandler = (
  sb: ReturnType<typeof createClient>,
  params: Record<string, unknown>,
) => Promise<Response>

const actions: Record<string, ActionHandler> = {
  // ── Entity Profile CRUD ──

  async find_or_create_entity(sb, params) {
    const { entity_type, name } = params as { entity_type: string; name: string }
    if (!entity_type || !name) {
      return jsonResponse({ error: 'entity_type and name are required' }, 400)
    }

    const { data, error } = await sb.rpc('find_or_create_entity', {
      p_org_id: DEFAULT_ORG_ID,
      p_entity_type: entity_type,
      p_name: name,
    })

    if (error) throw error
    return jsonResponse({ entity_id: data })
  },

  async get_entity(sb, params) {
    const { entity_id } = params as { entity_id: string }
    if (!entity_id) {
      return jsonResponse({ error: 'entity_id is required' }, 400)
    }

    const { data, error } = await sb.rpc('get_entity_memory', {
      p_entity_id: entity_id,
    })

    if (error) throw error
    return jsonResponse({ memory: data })
  },

  async update_entity_facts(sb, params) {
    const { entity_id, facts } = params as { entity_id: string; facts: Record<string, unknown> }
    if (!entity_id || !facts) {
      return jsonResponse({ error: 'entity_id and facts are required' }, 400)
    }

    // Merge new facts with existing
    const { data: existing, error: fetchErr } = await sb
      .from('entity_profiles')
      .select('facts')
      .eq('id', entity_id)
      .single()

    if (fetchErr) throw fetchErr

    const mergedFacts = { ...(existing?.facts || {}), ...facts }

    const { data, error } = await sb
      .from('entity_profiles')
      .update({ facts: mergedFacts })
      .eq('id', entity_id)
      .select()
      .single()

    if (error) throw error
    return jsonResponse({ entity: data })
  },

  async search_entities(sb, params) {
    const { query, entity_type, limit } = params as {
      query: string; entity_type?: string; limit?: number
    }
    if (!query) {
      return jsonResponse({ error: 'query is required' }, 400)
    }

    const { data, error } = await sb.rpc('search_entities', {
      p_org_id: DEFAULT_ORG_ID,
      p_query: query,
      p_entity_type: entity_type || null,
      p_limit: limit || 10,
    })

    if (error) throw error
    return jsonResponse({ results: data })
  },

  // ── Observations ──

  async log_observation(sb, params) {
    const {
      entity_type, entity_name, entity_id,
      observation_type, content, structured_data,
      source_channel, source_job_id, confidence,
    } = params as {
      entity_type?: string; entity_name?: string; entity_id?: string
      observation_type: string; content: string
      structured_data?: Record<string, unknown>
      source_channel?: string; source_job_id?: string
      confidence?: number
    }

    if (!content || !observation_type) {
      return jsonResponse({ error: 'content and observation_type are required' }, 400)
    }

    // Check feature flag
    const { data: memoryEnabled } = await sb.rpc('is_flag_enabled', {
      p_org_id: DEFAULT_ORG_ID,
      p_flag_key: 'jarvis.memory.enabled',
    })

    if (!memoryEnabled) {
      return jsonResponse({
        status: 'disabled',
        message: 'Memory system is disabled. Enable jarvis.memory.enabled flag.',
      })
    }

    // Resolve or create entity
    let resolvedEntityId = entity_id
    if (!resolvedEntityId && entity_type && entity_name) {
      const { data: eid, error: findErr } = await sb.rpc('find_or_create_entity', {
        p_org_id: DEFAULT_ORG_ID,
        p_entity_type: entity_type,
        p_name: entity_name,
      })
      if (findErr) throw findErr
      resolvedEntityId = eid
    }

    if (!resolvedEntityId) {
      return jsonResponse({ error: 'entity_id or (entity_type + entity_name) required' }, 400)
    }

    const { data, error } = await sb
      .from('entity_observations')
      .insert({
        org_id: DEFAULT_ORG_ID,
        entity_id: resolvedEntityId,
        observation_type,
        content,
        structured_data: structured_data || {},
        source_channel: source_channel || 'system',
        source_job_id: source_job_id || null,
        confidence: confidence ?? 0.80,
      })
      .select()
      .single()

    if (error) throw error
    return jsonResponse({ observation: data, entity_id: resolvedEntityId })
  },

  async get_observations(sb, params) {
    const { entity_id, observation_type, limit } = params as {
      entity_id: string; observation_type?: string; limit?: number
    }
    if (!entity_id) {
      return jsonResponse({ error: 'entity_id is required' }, 400)
    }

    let query = sb
      .from('entity_observations')
      .select('*')
      .eq('entity_id', entity_id)
      .eq('is_active', true)
      .order('observed_at', { ascending: false })
      .limit(limit || 50)

    if (observation_type) {
      query = query.eq('observation_type', observation_type)
    }

    const { data, error } = await query

    if (error) throw error
    return jsonResponse({ observations: data })
  },

  async supersede_observation(sb, params) {
    const { old_observation_id, new_content, new_observation_type } = params as {
      old_observation_id: string; new_content: string; new_observation_type?: string
    }
    if (!old_observation_id || !new_content) {
      return jsonResponse({ error: 'old_observation_id and new_content required' }, 400)
    }

    // Get old observation
    const { data: old, error: oldErr } = await sb
      .from('entity_observations')
      .select('*')
      .eq('id', old_observation_id)
      .single()

    if (oldErr) throw oldErr

    // Create replacement
    const { data: replacement, error: newErr } = await sb
      .from('entity_observations')
      .insert({
        org_id: old.org_id,
        entity_id: old.entity_id,
        observation_type: new_observation_type || old.observation_type,
        content: new_content,
        source_channel: old.source_channel,
        confidence: 0.90,
      })
      .select()
      .single()

    if (newErr) throw newErr

    // Mark old as superseded
    await sb
      .from('entity_observations')
      .update({ is_active: false, superseded_by: replacement.id })
      .eq('id', old_observation_id)

    return jsonResponse({ old_id: old_observation_id, new_observation: replacement })
  },

  // ── Corrections ──

  async log_correction(sb, params) {
    const {
      intention_id, correction_type, original_value,
      corrected_value, explanation, corrected_by, corrected_via, pattern,
    } = params as {
      intention_id?: string; correction_type: string
      original_value?: string; corrected_value: string
      explanation?: string; corrected_by?: string
      corrected_via?: string; pattern?: Record<string, unknown>
    }

    if (!correction_type || !corrected_value) {
      return jsonResponse({ error: 'correction_type and corrected_value required' }, 400)
    }

    // Check feature flag
    const { data: correctionsEnabled } = await sb.rpc('is_flag_enabled', {
      p_org_id: DEFAULT_ORG_ID,
      p_flag_key: 'jarvis.corrections',
    })

    if (!correctionsEnabled) {
      return jsonResponse({
        status: 'disabled',
        message: 'Corrections system is disabled. Enable jarvis.corrections flag.',
      })
    }

    const { data, error } = await sb
      .from('corrections')
      .insert({
        org_id: DEFAULT_ORG_ID,
        intention_id: intention_id || null,
        correction_type,
        original_value: original_value || null,
        corrected_value,
        explanation: explanation || null,
        corrected_by: corrected_by || null,
        corrected_via: corrected_via || 'telegram',
        pattern: pattern || {},
      })
      .select()
      .single()

    if (error) throw error
    return jsonResponse({ correction: data })
  },

  async get_corrections(sb, params) {
    const { limit, unapplied_only } = params as { limit?: number; unapplied_only?: boolean }

    if (unapplied_only) {
      let query = sb
        .from('corrections')
        .select('*')
        .eq('org_id', DEFAULT_ORG_ID)
        .eq('applied', false)
        .order('created_at', { ascending: false })
        .limit(limit || 20)

      const { data, error } = await query
      if (error) throw error
      return jsonResponse({ corrections: data })
    }

    const { data, error } = await sb.rpc('get_recent_corrections', {
      p_org_id: DEFAULT_ORG_ID,
      p_limit: limit || 20,
    })

    if (error) throw error
    return jsonResponse({ corrections: data })
  },

  // ── Commitments ──

  async create_commitment(sb, params) {
    const {
      committed_by, committed_to_name, description,
      due_at, due_description, job_id, entity_id,
      source_channel, source_text,
    } = params as {
      committed_by?: string; committed_to_name?: string
      description: string; due_at?: string; due_description?: string
      job_id?: string; entity_id?: string
      source_channel?: string; source_text?: string
    }

    if (!description) {
      return jsonResponse({ error: 'description is required' }, 400)
    }

    const { data, error } = await sb
      .from('commitments')
      .insert({
        org_id: DEFAULT_ORG_ID,
        committed_by: committed_by || null,
        committed_to_name: committed_to_name || null,
        description,
        due_at: due_at || null,
        due_description: due_description || null,
        job_id: job_id || null,
        entity_id: entity_id || null,
        source_channel: source_channel || 'system',
        source_text: source_text || null,
      })
      .select()
      .single()

    if (error) throw error
    return jsonResponse({ commitment: data })
  },

  async complete_commitment(sb, params) {
    const { commitment_id } = params as { commitment_id: string }
    if (!commitment_id) {
      return jsonResponse({ error: 'commitment_id is required' }, 400)
    }

    const { data, error } = await sb
      .from('commitments')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', commitment_id)
      .select()
      .single()

    if (error) throw error
    return jsonResponse({ commitment: data })
  },

  async list_commitments(sb, params) {
    const { status, user_id, limit } = params as {
      status?: string; user_id?: string; limit?: number
    }

    let query = sb
      .from('commitments')
      .select('*')
      .eq('org_id', DEFAULT_ORG_ID)
      .order('due_at', { ascending: true, nullsFirst: false })
      .limit(limit || 20)

    if (status) query = query.eq('status', status)
    if (user_id) query = query.eq('committed_by', user_id)

    const { data, error } = await query
    if (error) throw error
    return jsonResponse({ commitments: data })
  },

  async list_overdue(sb, _params) {
    // Mark overdue first
    await sb.rpc('mark_overdue_commitments')

    const { data, error } = await sb
      .from('commitments')
      .select('*')
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('status', 'overdue')
      .order('due_at', { ascending: true })

    if (error) throw error
    return jsonResponse({ overdue: data })
  },

  // ── Bulk Context Recall ──

  async recall_context(sb, params) {
    const { entity_names, job_id, include_corrections } = params as {
      entity_names?: string[]; job_id?: string; include_corrections?: boolean
    }

    const context: Record<string, unknown> = {}

    // Recall entity memories
    if (entity_names && entity_names.length > 0) {
      const entities: Record<string, unknown>[] = []
      for (const name of entity_names.slice(0, 5)) { // max 5 entities
        const { data: searchResults } = await sb.rpc('search_entities', {
          p_org_id: DEFAULT_ORG_ID,
          p_query: name,
          p_entity_type: null,
          p_limit: 1,
        })

        if (searchResults && searchResults.length > 0) {
          const { data: memory } = await sb.rpc('get_entity_memory', {
            p_entity_id: searchResults[0].id,
          })
          entities.push({ search_name: name, ...memory })
        }
      }
      context.entities = entities
    }

    // Recall job-linked observations
    if (job_id) {
      const { data: jobObs } = await sb
        .from('entity_observations')
        .select('*, entity_profiles!inner(name, entity_type)')
        .eq('source_job_id', job_id)
        .eq('is_active', true)
        .order('observed_at', { ascending: false })
        .limit(20)

      context.job_observations = jobObs || []

      // Linked commitments
      const { data: jobCommitments } = await sb
        .from('commitments')
        .select('*')
        .eq('job_id', job_id)
        .in('status', ['active', 'overdue'])

      context.job_commitments = jobCommitments || []
    }

    // Recent corrections for learning
    if (include_corrections) {
      const { data: corrections } = await sb.rpc('get_recent_corrections', {
        p_org_id: DEFAULT_ORG_ID,
        p_limit: 10,
      })
      context.recent_corrections = corrections
    }

    return jsonResponse({ context })
  },

  // ── Feature Flags ──

  async get_flags(sb, _params) {
    const { data, error } = await sb
      .from('feature_flags')
      .select('flag_key, enabled, description')
      .eq('org_id', DEFAULT_ORG_ID)
      .order('flag_key')

    if (error) throw error
    return jsonResponse({ flags: data })
  },

  async set_flag(sb, params) {
    const { flag_key, enabled } = params as { flag_key: string; enabled: boolean }
    if (!flag_key || typeof enabled !== 'boolean') {
      return jsonResponse({ error: 'flag_key and enabled (boolean) required' }, 400)
    }

    const { data, error } = await sb
      .from('feature_flags')
      .update({ enabled })
      .eq('org_id', DEFAULT_ORG_ID)
      .eq('flag_key', flag_key)
      .select()
      .single()

    if (error) throw error
    return jsonResponse({ flag: data })
  },

  // ── Confirmation handling ──

  async confirm_action(sb, params) {
    const { token, response } = params as { token: string; response: 'confirmed' | 'denied' }
    if (!token || !response) {
      return jsonResponse({ error: 'token and response required' }, 400)
    }

    // Find pending confirmation
    const { data: confirmation, error: findErr } = await sb
      .from('pending_confirmations')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (findErr || !confirmation) {
      return jsonResponse({ error: 'Confirmation not found or expired' }, 404)
    }

    // Check expiry
    if (new Date(confirmation.expires_at) < new Date()) {
      await sb.from('pending_confirmations')
        .update({ status: 'expired' })
        .eq('id', confirmation.id)
      return jsonResponse({ error: 'Confirmation expired' }, 410)
    }

    // Update confirmation
    await sb.from('pending_confirmations')
      .update({ status: response, responded_at: new Date().toISOString() })
      .eq('id', confirmation.id)

    // Update intention log
    const newStatus = response === 'confirmed' ? 'authorised' : 'cancelled'
    await sb.from('intention_log')
      .update({
        status: newStatus,
        confirmed_at: response === 'confirmed' ? new Date().toISOString() : null,
      })
      .eq('id', confirmation.intention_id)

    return jsonResponse({
      status: response,
      intention_id: confirmation.intention_id,
      action: confirmation.action,
      params: confirmation.params,
    })
  },
}

// ────────────────────────────────────────────────────────────
// MAIN HANDLER
// ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json()
    const { action, params } = body as { action: string; params: Record<string, unknown> }

    if (!action) {
      return jsonResponse({ error: 'action is required' }, 400)
    }

    const handler = actions[action]
    if (!handler) {
      return jsonResponse({
        error: `Unknown action: ${action}`,
        available: Object.keys(actions),
      }, 400)
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return await handler(sb, params || {})

  } catch (err) {
    console.error('JARVIS memory error:', err)
    return jsonResponse({ error: err.message || 'Internal error' }, 500)
  }
})
