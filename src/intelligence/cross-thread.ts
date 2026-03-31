// ════════════════════════════════════════════════════════════
// Cross-Thread Intelligence — Signal detection & propagation
//
// Detects signals in messages (supplier delays, payments,
// schedule changes), registers them, and propagates actions
// across channels (flag crew, suggest follow-ups, etc.).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { enqueueEvent } from '../events/event-queue.js';
import { execute as storeObservation } from '../tools/memory/store-observation.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export type SignalType = 'supplier_delay' | 'client_engagement' | 'payment_received' | 'commitment_made' | 'schedule_change';

export interface SignalInput {
  sourceChannel: string;
  sourceThreadId: string;
  signalType: SignalType;
  entityId: string;
  signalData: Record<string, unknown>;
  sourceMessageId?: string;
  sourceEventId?: string;
  confidenceScore?: number;
}

// Signal → actions mapping
const SIGNAL_ACTIONS: Record<SignalType, Array<{ actionType: string; targetChannel?: string }>> = {
  supplier_delay: [
    { actionType: 'flag_crew', targetChannel: 'telegram' },
    { actionType: 'suggest_followup', targetChannel: 'telegram' },
    { actionType: 'log_observation' },
  ],
  client_engagement: [
    { actionType: 'suggest_followup', targetChannel: 'telegram' },
    { actionType: 'log_observation' },
  ],
  payment_received: [
    { actionType: 'trigger_workflow' },
    { actionType: 'log_observation' },
  ],
  commitment_made: [
    { actionType: 'log_observation' },
    { actionType: 'suggest_followup', targetChannel: 'telegram' },
  ],
  schedule_change: [
    { actionType: 'flag_crew', targetChannel: 'telegram' },
    { actionType: 'suggest_followup', targetChannel: 'telegram' },
    { actionType: 'log_observation' },
  ],
};

// Detection patterns
const SIGNAL_PATTERNS: Record<SignalType, RegExp[]> = {
  supplier_delay: [
    /\b(?:delayed?|back\s?order(?:ed)?|out of stock|pushed back|lead time|ETA\s+\d)/i,
    /\b(?:won't arrive|not available|supply issue|shortage|allocation)\b/i,
    /\b(?:Colorbond|SolarSpan|Stratco|Lysaght|BlueScope)\b.*\b(?:delay|wait|week|month)\b/i,
  ],
  client_engagement: [
    /\b(?:opened|clicked|viewed|downloaded|submitted|responded)\b/i,
  ],
  payment_received: [
    /\b(?:payment|paid|transferred|deposited|cleared|receipt)\b.*\$?\d/i,
    /\b(?:invoice\s+#?\d+.*(?:paid|settled|cleared))\b/i,
  ],
  schedule_change: [
    /\b(?:reschedul|moved? to|push(?:ed)? (?:back|to)|bring forward|postpone|cancel)\b/i,
    /\b(?:weather|rain|storm)\b.*\b(?:delay|cancel|postpone|move)\b/i,
    /\b(?:next week|next month|different day|change.*date)\b/i,
  ],
  commitment_made: [
    // Cross-referenced with commitment detector — lower confidence here
    /\b(?:promise|guarantee|commit|will have|by (?:Monday|Tuesday|Wednesday|Thursday|Friday))\b/i,
  ],
};

/**
 * Register a detected signal and queue propagation actions.
 */
export async function registerSignal(input: SignalInput): Promise<string> {
  const sb = getSupabase();

  // Insert signal
  const { data: signal, error } = await sb
    .from('cross_thread_signals')
    .insert({
      source_channel: input.sourceChannel,
      source_thread_id: input.sourceThreadId,
      signal_type: input.signalType,
      entity_id: input.entityId,
      signal_data: input.signalData,
      detected_at: new Date().toISOString(),
      source_message_id: input.sourceMessageId || null,
      source_event_id: input.sourceEventId || null,
      confidence_score: input.confidenceScore ?? 0.75,
      propagation_status: 'detected',
    })
    .select('id')
    .single();

  if (error) throw error;

  // Store as memory observation
  try {
    await storeObservation({
      entity_name: input.entityId,
      entity_type: 'client',
      observation_type: 'interaction',
      content: `Cross-thread signal: ${input.signalType} from ${input.sourceChannel} — ${JSON.stringify(input.signalData).slice(0, 200)}`,
      source_channel: 'system',
    });
  } catch {
    // Memory storage failure is non-fatal
  }

  // Queue propagation actions
  const actions = SIGNAL_ACTIONS[input.signalType] || [];
  for (const action of actions) {
    await sb.from('cross_thread_actions').insert({
      signal_id: signal.id,
      action_type: action.actionType,
      target_channel: action.targetChannel || null,
      action_status: 'queued',
    });
  }

  return signal.id;
}

/**
 * Propagate a signal's queued actions.
 */
export async function propagateSignal(signalId: string): Promise<void> {
  const sb = getSupabase();

  // Load signal + actions
  const { data: signal } = await sb
    .from('cross_thread_signals')
    .select('*')
    .eq('id', signalId)
    .single();

  if (!signal) return;

  const { data: actions } = await sb
    .from('cross_thread_actions')
    .select('*')
    .eq('signal_id', signalId)
    .eq('action_status', 'queued');

  if (!actions || actions.length === 0) return;

  const propagatedChannels: string[] = [];

  for (const action of actions) {
    try {
      switch (action.action_type) {
        case 'flag_crew':
          await enqueueEvent('schedule_trigger', 'cross_thread', {
            action: 'crew_notification',
            signal_type: signal.signal_type,
            entity_id: signal.entity_id,
            signal_data: signal.signal_data,
          }, 25); // high priority
          break;

        case 'suggest_followup':
          await enqueueEvent('schedule_trigger', 'cross_thread', {
            action: 'morning_brief',
            followup_suggestion: {
              signal_type: signal.signal_type,
              entity_id: signal.entity_id,
              signal_data: signal.signal_data,
            },
          }, 50);
          break;

        case 'trigger_workflow':
          await enqueueEvent('status_change', 'cross_thread', {
            change_type: signal.signal_type === 'payment_received' ? 'payment_received' : 'job_milestone',
            ...signal.signal_data,
          }, 25);
          break;

        case 'log_observation':
          try {
            await storeObservation({
              entity_name: signal.entity_id,
              entity_type: 'client',
              observation_type: 'fact',
              content: `Signal propagated: ${signal.signal_type} — ${JSON.stringify(signal.signal_data).slice(0, 300)}`,
              source_channel: 'system',
            });
          } catch {
            // Non-fatal
          }
          break;
      }

      if (action.target_channel) propagatedChannels.push(action.target_channel);

      await sb.from('cross_thread_actions').update({
        action_status: 'executed',
        executed_at: new Date().toISOString(),
        result: { success: true },
      }).eq('id', action.id);
    } catch (err) {
      await sb.from('cross_thread_actions').update({
        action_status: 'failed',
        executed_at: new Date().toISOString(),
        result: { error: (err as Error).message },
      }).eq('id', action.id);
    }
  }

  // Update signal status
  await sb.from('cross_thread_signals').update({
    propagation_status: 'propagated',
    propagated_to_channels: propagatedChannels,
  }).eq('id', signalId);
}

/**
 * Detect signals in message text.
 * Returns array of detected signals with confidence scores.
 */
export async function detectSignals(
  channel: string,
  messageText: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<SignalInput[]> {
  const detected: SignalInput[] = [];

  for (const [signalType, patterns] of Object.entries(SIGNAL_PATTERNS)) {
    for (const pattern of patterns) {
      const match = messageText.match(pattern);
      if (match) {
        detected.push({
          sourceChannel: channel,
          sourceThreadId: (metadata.thread_id as string) || '',
          signalType: signalType as SignalType,
          entityId,
          signalData: {
            matched_text: match[0],
            full_message: messageText.slice(0, 500),
            ...metadata,
          },
          sourceMessageId: (metadata.message_id as string) || undefined,
          confidenceScore: 0.70,
        });
        break; // One match per signal type per message
      }
    }
  }

  return detected;
}

/**
 * Get active signals with optional filters.
 */
export async function getActiveSignals(
  entityId?: string,
  signalType?: string,
  since?: Date,
): Promise<unknown[]> {
  const sb = getSupabase();

  let query = sb
    .from('cross_thread_signals')
    .select('*, cross_thread_actions(*)')
    .in('propagation_status', ['detected', 'enriched', 'propagated'])
    .order('created_at', { ascending: false })
    .limit(50);

  if (entityId) query = query.eq('entity_id', entityId);
  if (signalType) query = query.eq('signal_type', signalType);
  if (since) query = query.gte('created_at', since.toISOString());

  const { data } = await query;
  return data || [];
}

/**
 * Scan for signals with queued actions and propagate them.
 * Intended to run on scheduler interval (every 60s).
 */
export async function scanForPropagation(): Promise<void> {
  const sb = getSupabase();

  const { data: signals } = await sb
    .from('cross_thread_signals')
    .select('id')
    .eq('propagation_status', 'detected')
    .limit(20);

  if (!signals || signals.length === 0) return;

  for (const signal of signals) {
    try {
      await propagateSignal(signal.id);
    } catch (err) {
      console.error(`Failed to propagate signal ${signal.id}:`, err);
    }
  }
}
