// ════════════════════════════════════════════════════════════
// Memory Consolidation Worker
//
// Nightly cron (midnight AWST) via Railway.
// 1. Query agent_memory_log for past 24h events
// 2. Group by entity_id
// 3. For entities with >3 events: summarise via Claude Sonnet,
//    store consolidated insights, auto-embed
// 4. Archive observations >30 days old (if already consolidated)
// 5. Keep corrections + business_directives indefinitely
// ════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '../utils/embeddings.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const CONSOLIDATION_THRESHOLD = 3; // min events per entity to trigger
const ARCHIVE_AGE_DAYS = 30;

let _sb: SupabaseClient | null = null;
let _anthropic: Anthropic | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    _sb = createClient(url, key);
  }
  return _sb;
}

function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY must be set');
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

export async function runNightlyConsolidation(): Promise<{
  entitiesProcessed: number;
  insightsGenerated: number;
}> {
  const sb = getSupabase();
  const since = new Date();
  since.setHours(since.getHours() - 24);

  let entitiesProcessed = 0;
  let insightsGenerated = 0;

  // ── Step 1: Query past 24h agent memory events ──
  const { data: events, error: eventsErr } = await sb
    .from('agent_memory_log')
    .select('*, entity_profiles(name, entity_type)')
    .gte('created_at', since.toISOString())
    .not('entity_id', 'is', null)
    .order('created_at', { ascending: true });

  if (eventsErr) throw eventsErr;
  if (!events || events.length === 0) {
    await logConsolidationRun(sb, 0, 0);
    return { entitiesProcessed: 0, insightsGenerated: 0 };
  }

  // ── Step 2: Group by entity_id ──
  const grouped = new Map<string, typeof events>();
  for (const event of events) {
    const eid = event.entity_id as string;
    if (!grouped.has(eid)) grouped.set(eid, []);
    grouped.get(eid)!.push(event);
  }

  // ── Step 3: Consolidate entities with >3 events ──
  for (const [entityId, entityEvents] of grouped) {
    if (entityEvents.length < CONSOLIDATION_THRESHOLD) continue;

    const entityName = entityEvents[0].entity_profiles?.name || 'Unknown';
    const entityType = entityEvents[0].entity_profiles?.entity_type || 'unknown';

    // Compile events into text block
    const eventSummary = entityEvents
      .map((e) => `[${e.event_type}] ${JSON.stringify(e.content)}`)
      .join('\n');

    // Call Claude Sonnet for summarisation
    try {
      const anthropic = getAnthropic();
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Summarize these observations about ${entityName} (${entityType}) into 2-3 key insights. Focus on: behavioral patterns, preferences, reliability, communication style. Output JSON only: { "insights": ["string", ...], "updated_traits": { "key": "value", ... } }\n\nObservations:\n${eventSummary}`,
          },
        ],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text);

      // Store each insight as observation
      for (const insight of parsed.insights || []) {
        const embedding = await generateEmbedding(insight).catch(() => null);

        const row: Record<string, unknown> = {
          org_id: DEFAULT_ORG_ID,
          entity_id: entityId,
          observation_type: 'consolidated_daily',
          content: insight,
          source_channel: 'system',
          confidence: 0.80,
          visibility_scope: 'public',
        };

        if (embedding) {
          row.embedding = `[${embedding.join(',')}]`;
        }

        await sb.from('entity_observations').insert(row);
        insightsGenerated++;
      }

      // Update entity facts with traits
      if (parsed.updated_traits && Object.keys(parsed.updated_traits).length > 0) {
        const { data: existing } = await sb
          .from('entity_profiles')
          .select('facts')
          .eq('id', entityId)
          .single();

        const mergedFacts = { ...(existing?.facts || {}), ...parsed.updated_traits };
        await sb
          .from('entity_profiles')
          .update({ facts: mergedFacts })
          .eq('id', entityId);
      }

      entitiesProcessed++;
    } catch (err) {
      console.error(`Consolidation failed for entity ${entityId}:`, err);
    }
  }

  // ── Step 4: Archive old observations ──
  const archiveCutoff = new Date();
  archiveCutoff.setDate(archiveCutoff.getDate() - ARCHIVE_AGE_DAYS);

  await sb
    .from('entity_observations')
    .update({ is_active: false })
    .eq('is_active', true)
    .eq('observation_type', 'consolidated_daily')
    .lt('observed_at', archiveCutoff.toISOString());

  // Note: corrections and business_directives are kept indefinitely (no archival)

  // ── Step 5: Log run ──
  await logConsolidationRun(sb, entitiesProcessed, insightsGenerated);

  return { entitiesProcessed, insightsGenerated };
}

async function logConsolidationRun(
  sb: SupabaseClient,
  entitiesProcessed: number,
  insightsGenerated: number,
): Promise<void> {
  const { createHash } = await import('crypto');
  const content = { entitiesProcessed, insightsGenerated, timestamp: new Date().toISOString() };
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');

  const { data: prev } = await sb
    .from('agent_memory_log')
    .select('hash')
    .eq('org_id', DEFAULT_ORG_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  await sb.from('agent_memory_log').insert({
    org_id: DEFAULT_ORG_ID,
    event_type: 'consolidation_run',
    channel: 'cron',
    content,
    hash,
    previous_hash: prev?.hash || null,
  });
}
