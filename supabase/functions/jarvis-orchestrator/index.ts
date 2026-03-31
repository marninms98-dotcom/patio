// ════════════════════════════════════════════════════════════
// JARVIS — Orchestrator Edge Function
//
// The safety spine: every inbound request flows through here.
// 1. Parse raw input → detect intention
// 2. Check feature flags (is this capability even on?)
// 3. Check authority (is this user/channel allowed?)
// 4. Rate-limit check
// 5. If confirmation required → create pending_confirmation
// 6. If authorised → execute action
// 7. Log everything to intention_log
//
// Deploy: supabase functions deploy jarvis-orchestrator
// Endpoint: POST /functions/v1/jarvis-orchestrator
//
// Payload:
// {
//   "channel": "telegram" | "web" | "api",
//   "user_id": "uuid",            // optional, resolved from auth if web
//   "raw_input": "string",        // the user's message/command
//   "context": { ... }            // optional extra context
// }
// ════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001'

// ────────────────────────────────────────────────────────────
// Intent definitions: keyword/pattern → intent mapping
// ────────────────────────────────────────────────────────────
interface IntentMatch {
  intent: string
  confidence: number
  params: Record<string, string>
  entity_type?: string
}

const INTENT_PATTERNS: Array<{
  intent: string
  patterns: RegExp[]
  extract?: (match: RegExpMatchArray, input: string) => Record<string, string>
  entity_type?: string
}> = [
  {
    intent: 'view_pipeline',
    patterns: [
      /\b(pipeline|dashboard|overview|summary|how many jobs|job count)\b/i,
    ],
  },
  {
    intent: 'read_job',
    patterns: [
      /\b(show|find|get|lookup|check|what'?s?|status of)\b.*\b(job|quote|scope)\b/i,
      /\bjob\s+(?:ref\s+)?([A-Z0-9-]+)/i,
    ],
    extract: (_match, input) => {
      const refMatch = input.match(/\b([A-Z]{2,}-?\d{3,})\b/i)
      return refMatch ? { job_ref: refMatch[1] } : {}
    },
    entity_type: 'job',
  },
  {
    intent: 'create_job',
    patterns: [
      /\b(new|create|start|add)\b.*\b(job|quote|scope|lead)\b/i,
    ],
  },
  {
    intent: 'update_job',
    patterns: [
      /\b(update|change|modify|set|move)\b.*\b(job|quote|status)\b/i,
    ],
    entity_type: 'job',
  },
  {
    intent: 'send_quote',
    patterns: [
      /\b(send|email|deliver)\b.*\b(quote|proposal)\b/i,
    ],
    entity_type: 'job',
  },
  {
    intent: 'manage_schedule',
    patterns: [
      /\b(schedule|book|assign|calendar|when|install date)\b/i,
    ],
  },
  {
    intent: 'run_report',
    patterns: [
      /\b(report|revenue|sales|stats|analytics|numbers|totals)\b/i,
    ],
  },
  {
    intent: 'log_observation',
    patterns: [
      /\b(remember|note|record|log|fyi|heads up)\b/i,
    ],
  },
  {
    intent: 'search_memory',
    patterns: [
      /\b(what do (you|we) know about|recall|history|past|previous)\b/i,
      /\b(do (you|we) (know|have|remember))\b/i,
    ],
  },
]

// Commitment detection patterns
const COMMITMENT_PATTERNS: RegExp[] = [
  /i'?ll\s+(.+?)(?:\bby\b|\bbefore\b|\btoday\b|\btomorrow\b|\bmonday\b|\btuesday\b|\bwednesday\b|\bthursday\b|\bfriday\b|$)/i,
  /(?:will|going to|gonna)\s+(.+?)(?:\bby\b|\bbefore\b|\btoday\b|\btomorrow\b|$)/i,
  /(?:promise|commit|guarantee)\s+(?:to\s+)?(.+)/i,
  /(?:need to|have to|must)\s+(.+?)(?:\bby\b|\bbefore\b|\btoday\b|\btomorrow\b|$)/i,
]

const DUE_PATTERNS: Array<{ pattern: RegExp; resolver: () => Date }> = [
  { pattern: /\btoday\b/i, resolver: () => { const d = new Date(); d.setHours(17, 0, 0, 0); return d } },
  { pattern: /\btomorrow\b/i, resolver: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(17, 0, 0, 0); return d } },
  { pattern: /\bby\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i, resolver: () => new Date() }, // placeholder, parsed in function
  { pattern: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i, resolver: () => new Date() },
]

// ────────────────────────────────────────────────────────────
// CORS helper
// ────────────────────────────────────────────────────────────
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
// MAIN HANDLER
// ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const startTime = Date.now()
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  try {
    const body = await req.json()
    const { channel, user_id, raw_input, context } = body

    if (!raw_input || !channel) {
      return jsonResponse({ error: 'raw_input and channel are required' }, 400)
    }

    // ── Step 0: Master kill switch ──
    const { data: masterFlag } = await sb.rpc('is_flag_enabled', {
      p_org_id: DEFAULT_ORG_ID,
      p_flag_key: 'jarvis.enabled',
    })

    if (!masterFlag) {
      return jsonResponse({
        status: 'disabled',
        message: 'JARVIS is currently disabled. Enable the jarvis.enabled feature flag to activate.',
      })
    }

    // ── Step 1: Detect intention ──
    const intentMatch = detectIntent(raw_input)

    // ── Step 2: Resolve user role ──
    const userRole = await resolveUserRole(sb, user_id)

    // ── Step 3: Check authority ──
    const { data: authority } = await sb.rpc('check_authority', {
      p_org_id: DEFAULT_ORG_ID,
      p_role: userRole,
      p_channel: channel,
      p_action: intentMatch.intent,
    })

    const authorised = authority?.allowed === true

    // ── Step 4: Rate limit check ──
    let rateLimited = false
    if (authorised && authority?.max_per_day && user_id) {
      const { data: todayCount } = await sb.rpc('count_intentions_today', {
        p_org_id: DEFAULT_ORG_ID,
        p_user_id: user_id,
        p_action: intentMatch.intent,
      })
      if (todayCount >= authority.max_per_day) {
        rateLimited = true
      }
    }

    // ── Step 5: Log intention ──
    const intentionRecord = {
      org_id: DEFAULT_ORG_ID,
      user_id: user_id || null,
      channel,
      raw_input,
      detected_intent: intentMatch.intent,
      confidence: intentMatch.confidence,
      parsed_params: intentMatch.params,
      entity_type: intentMatch.entity_type || null,
      authority_check: authority || {},
      authorised: authorised && !rateLimited,
      status: 'pending' as string,
      started_at: new Date().toISOString(),
    }

    if (!authorised) {
      intentionRecord.status = 'denied'
    } else if (rateLimited) {
      intentionRecord.status = 'denied'
    } else if (authority?.requires_confirmation) {
      intentionRecord.status = 'confirming'
    } else {
      intentionRecord.status = 'authorised'
    }

    const { data: intention, error: intentionError } = await sb
      .from('intention_log')
      .insert(intentionRecord)
      .select()
      .single()

    if (intentionError) throw intentionError

    // ── Step 6: Handle confirmation flow ──
    if (intentionRecord.status === 'confirming') {
      const confirmToken = crypto.randomUUID().slice(0, 24)

      await sb.from('pending_confirmations').insert({
        org_id: DEFAULT_ORG_ID,
        intention_id: intention.id,
        user_id: user_id || null,
        channel,
        action: intentMatch.intent,
        description: buildConfirmationMessage(intentMatch),
        params: intentMatch.params,
        token: confirmToken,
      })

      const duration = Date.now() - startTime
      await sb.from('intention_log').update({
        confirmation_token: confirmToken,
        duration_ms: duration,
      }).eq('id', intention.id)

      return jsonResponse({
        status: 'confirming',
        intention_id: intention.id,
        confirmation_token: confirmToken,
        message: buildConfirmationMessage(intentMatch),
        intent: intentMatch.intent,
        confidence: intentMatch.confidence,
      })
    }

    // ── Step 7: Check for commitments ──
    const commitment = detectCommitment(raw_input)
    if (commitment) {
      // Check if commitment detection is enabled
      const { data: commitmentFlag } = await sb.rpc('is_flag_enabled', {
        p_org_id: DEFAULT_ORG_ID,
        p_flag_key: 'jarvis.commitment_detection',
      })

      if (commitmentFlag) {
        await sb.from('commitments').insert({
          org_id: DEFAULT_ORG_ID,
          committed_by: user_id || null,
          description: commitment.description,
          due_at: commitment.due_at || null,
          due_description: commitment.due_description || null,
          source_intention_id: intention.id,
          source_channel: channel,
          source_text: raw_input,
        })
      }
    }

    // ── Step 8: Build response ──
    const duration = Date.now() - startTime
    const finalStatus = authorised && !rateLimited ? 'completed' : 'denied'

    await sb.from('intention_log').update({
      status: finalStatus,
      completed_at: new Date().toISOString(),
      duration_ms: duration,
      result_summary: authorised ? `Intent "${intentMatch.intent}" authorised` : 'Denied',
    }).eq('id', intention.id)

    if (!authorised) {
      return jsonResponse({
        status: 'denied',
        intention_id: intention.id,
        intent: intentMatch.intent,
        reason: rateLimited ? 'rate_limit_exceeded' : 'not_authorised',
        message: rateLimited
          ? 'Daily limit reached for this action.'
          : `Action "${intentMatch.intent}" is not allowed for role "${userRole}" via "${channel}".`,
      })
    }

    return jsonResponse({
      status: 'authorised',
      intention_id: intention.id,
      intent: intentMatch.intent,
      confidence: intentMatch.confidence,
      params: intentMatch.params,
      entity_type: intentMatch.entity_type,
      commitment: commitment || null,
      duration_ms: duration,
    })

  } catch (err) {
    console.error('JARVIS orchestrator error:', err)
    return jsonResponse({ error: err.message || 'Internal error' }, 500)
  }
})

// ════════════════════════════════════════════════════════════
// INTENT DETECTION
// ════════════════════════════════════════════════════════════

function detectIntent(input: string): IntentMatch {
  const normalised = input.trim().toLowerCase()

  for (const rule of INTENT_PATTERNS) {
    for (const pattern of rule.patterns) {
      const match = normalised.match(pattern)
      if (match) {
        const params = rule.extract ? rule.extract(match, input) : {}
        return {
          intent: rule.intent,
          confidence: 0.85,
          params,
          entity_type: rule.entity_type,
        }
      }
    }
  }

  // No match — unknown intent
  return {
    intent: 'unknown',
    confidence: 0.0,
    params: {},
  }
}

// ════════════════════════════════════════════════════════════
// COMMITMENT DETECTION
// ════════════════════════════════════════════════════════════

interface DetectedCommitment {
  description: string
  due_at: string | null
  due_description: string | null
}

function detectCommitment(input: string): DetectedCommitment | null {
  for (const pattern of COMMITMENT_PATTERNS) {
    const match = input.match(pattern)
    if (match && match[1]) {
      const description = match[1].trim()
      if (description.length < 5) continue // too short to be meaningful

      // Try to extract a due date
      let dueAt: string | null = null
      let dueDescription: string | null = null

      if (/\btoday\b/i.test(input)) {
        const d = new Date()
        d.setHours(17, 0, 0, 0)
        dueAt = d.toISOString()
        dueDescription = 'today by 5pm'
      } else if (/\btomorrow\b/i.test(input)) {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(17, 0, 0, 0)
        dueAt = d.toISOString()
        dueDescription = 'tomorrow by 5pm'
      } else if (/\bby\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.test(input)) {
        const timeMatch = input.match(/\bby\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
        if (timeMatch) {
          let hours = parseInt(timeMatch[1])
          const minutes = parseInt(timeMatch[2] || '0')
          const meridiem = timeMatch[3].toLowerCase()
          if (meridiem === 'pm' && hours < 12) hours += 12
          if (meridiem === 'am' && hours === 12) hours = 0
          const d = new Date()
          d.setHours(hours, minutes, 0, 0)
          if (d < new Date()) d.setDate(d.getDate() + 1) // next day if time has passed
          dueAt = d.toISOString()
          dueDescription = `by ${timeMatch[1]}${timeMatch[2] ? ':' + timeMatch[2] : ''}${meridiem}`
        }
      }

      // Check for day-of-week
      const dayMatch = input.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
      if (dayMatch && !dueAt) {
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
        const targetDay = days.indexOf(dayMatch[1].toLowerCase())
        const now = new Date()
        const currentDay = now.getDay()
        let daysUntil = targetDay - currentDay
        if (daysUntil <= 0) daysUntil += 7
        const d = new Date()
        d.setDate(d.getDate() + daysUntil)
        d.setHours(17, 0, 0, 0)
        dueAt = d.toISOString()
        dueDescription = `by ${dayMatch[1]} 5pm`
      }

      return { description, due_at: dueAt, due_description: dueDescription }
    }
  }

  return null
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function resolveUserRole(
  sb: ReturnType<typeof createClient>,
  userId: string | undefined,
): Promise<string> {
  if (!userId) return 'anonymous'

  const { data } = await sb
    .from('users')
    .select('role')
    .eq('id', userId)
    .single()

  return data?.role || 'anonymous'
}

function buildConfirmationMessage(intent: IntentMatch): string {
  const messages: Record<string, string> = {
    create_job: 'Create a new job? Please confirm.',
    update_job: `Update job${intent.params.job_ref ? ' ' + intent.params.job_ref : ''}? Please confirm.`,
    send_quote: `Send quote${intent.params.job_ref ? ' for ' + intent.params.job_ref : ''}? Please confirm.`,
    delete_job: `Delete job${intent.params.job_ref ? ' ' + intent.params.job_ref : ''}? This cannot be undone.`,
    manage_schedule: 'Modify the schedule? Please confirm.',
  }

  return messages[intent.intent] || `Execute "${intent.intent}"? Please confirm.`
}
