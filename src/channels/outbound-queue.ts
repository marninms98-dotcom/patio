// ════════════════════════════════════════════════════════════
// Outbound Message Queue
//
// Rate-limited, priority-ordered outbound message delivery.
// Rules:
// - Max 1 outbound per entity per hour (configurable)
// - Priority ordering (1=highest, 10=lowest)
// - Batch lower-priority messages if multiple queued per entity
// - Telegram: 1 msg/sec/chat, 30 msg/sec global
// - GHL API: 100 requests/10 seconds
// - Retry failed with exponential backoff (max 3 retries)
//
// processQueue() called every 30 seconds by Railway worker.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { rateLimit as redisRateLimit } from '../utils/redis.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const ENTITY_RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_RETRIES = 3;

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    _sb = createClient(url, key);
  }
  return _sb;
}

/**
 * Enqueue an outbound message for delivery.
 */
export async function enqueueMessage(
  entityId: string,
  channel: string,
  content: unknown,
  priority: number = 5,
  scheduledFor?: Date,
  intentionId?: string,
): Promise<void> {
  const sb = getSupabase();

  await sb.from('outbound_message_queue').insert({
    entity_id: entityId,
    channel,
    priority,
    content,
    status: 'queued',
    scheduled_for: scheduledFor?.toISOString() || null,
    intention_id: intentionId || null,
  });
}

/**
 * Process the outbound queue. Called every 30 seconds.
 * Sends highest-priority message per entity, holds rest if within rate window.
 */
export async function processQueue(): Promise<{
  sent: number;
  held: number;
  failed: number;
}> {
  const sb = getSupabase();
  const now = new Date();
  let sent = 0;
  let held = 0;
  let failed = 0;

  // ── Fetch queued messages ready to send ──
  const { data: queued, error } = await sb
    .from('outbound_message_queue')
    .select('*')
    .eq('status', 'queued')
    .or(`scheduled_for.is.null,scheduled_for.lte.${now.toISOString()}`)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(100);

  if (error || !queued || queued.length === 0) {
    return { sent: 0, held: 0, failed: 0 };
  }

  // ── Group by entity_id ──
  const grouped = new Map<string, typeof queued>();
  for (const msg of queued) {
    const key = msg.entity_id || 'no_entity';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(msg);
  }

  // ── Process each entity group ──
  for (const [entityId, messages] of grouped) {
    // Rate limit: 1 per entity per hour
    if (entityId !== 'no_entity') {
      const rl = await redisRateLimit(`outbound:${entityId}`, 1, ENTITY_RATE_WINDOW_MS);
      if (!rl.allowed) {
        // Hold all messages for this entity
        held += messages.length;
        continue;
      }
    }

    // Send highest priority (first in sorted list)
    const toSend = messages[0];
    const rest = messages.slice(1);

    // Channel-specific rate limits (global + per-chat for Telegram)
    const channelAllowed = await checkChannelRateLimit(toSend.channel, toSend);
    if (!channelAllowed) {
      held += messages.length;
      continue;
    }

    // Attempt send
    const success = await attemptSend(toSend);

    if (success) {
      await sb
        .from('outbound_message_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', toSend.id);
      sent++;

      // Batch remaining lower-priority messages
      if (rest.length > 0) {
        const restIds = rest.map((m) => m.id);
        await sb
          .from('outbound_message_queue')
          .update({ status: 'batched' })
          .in('id', restIds);
        held += rest.length;
      }
    } else {
      // Check retry count from metadata
      const retryCount = (toSend.content as any)?._retryCount || 0;

      if (retryCount >= MAX_RETRIES) {
        await sb
          .from('outbound_message_queue')
          .update({
            status: 'failed',
            error_message: `Failed after ${MAX_RETRIES} retries`,
          })
          .eq('id', toSend.id);
        failed++;
      } else {
        // Exponential backoff: 30s, 60s, 120s
        const backoffMs = 30_000 * Math.pow(2, retryCount);
        const retryAt = new Date(Date.now() + backoffMs);

        await sb
          .from('outbound_message_queue')
          .update({
            scheduled_for: retryAt.toISOString(),
            content: { ...(toSend.content as object), _retryCount: retryCount + 1 },
          })
          .eq('id', toSend.id);
        held++;
      }
    }
  }

  return { sent, held, failed };
}

/**
 * Cancel all pending messages for an entity.
 */
export async function cancelPendingForEntity(entityId: string): Promise<number> {
  const sb = getSupabase();

  const { data } = await sb
    .from('outbound_message_queue')
    .update({ status: 'cancelled' })
    .eq('entity_id', entityId)
    .eq('status', 'queued')
    .select('id');

  return data?.length || 0;
}

/**
 * Cancel all pending messages for a specific intention/thread.
 */
export async function cancelPendingForThread(intentionId: string): Promise<number> {
  const sb = getSupabase();

  const { data } = await sb
    .from('outbound_message_queue')
    .update({ status: 'cancelled' })
    .eq('intention_id', intentionId)
    .eq('status', 'queued')
    .select('id');

  return data?.length || 0;
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function checkChannelRateLimit(
  channel: string,
  message?: Record<string, unknown>,
): Promise<boolean> {
  switch (channel) {
    case 'telegram': {
      // 30 msg/sec global
      const globalRl = await redisRateLimit('outbound:telegram:global', 30, 1000);
      if (!globalRl.allowed) return false;

      // 1 msg/sec per chat
      const chatId = (message?.content as any)?.chat_id;
      if (chatId) {
        const chatRl = await redisRateLimit(`outbound:telegram:chat:${chatId}`, 1, 1000);
        if (!chatRl.allowed) return false;
      }

      return true;
    }
    case 'email': {
      // Graph API: 10,000/10min — generous, just basic guard
      const rl = await redisRateLimit('outbound:email:global', 100, 60_000);
      return rl.allowed;
    }
    default:
      return true;
  }
}

async function attemptSend(message: Record<string, unknown>): Promise<boolean> {
  // Actual send logic will be implemented per channel.
  // For now, this is a stub that logs and succeeds.
  // In production:
  // - telegram: POST to Telegram Bot API sendMessage
  // - email: send via Graph API /sendMail
  // - sms: via Twilio or similar
  const channel = message.channel as string;
  const content = message.content as Record<string, unknown>;

  console.log(`[outbound-queue] Would send via ${channel}:`, JSON.stringify(content).slice(0, 200));

  // Return true = sent successfully (stub)
  // Real implementation would check response codes
  return true;
}
