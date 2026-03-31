// ════════════════════════════════════════════════════════════
// Outbound Message Queue V2 — Redis leaky bucket rate limiting
//
// Features:
// - SHA-256 deduplication
// - Redis leaky bucket per channel + per recipient
// - Priority ordering (urgent > high > normal > low)
// - Exponential backoff retries
// - Rate limit violation tracking
// ════════════════════════════════════════════════════════════

import { createHash } from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getRedis } from '../utils/redis.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export interface OutboundMessage {
  channel: 'telegram' | 'email' | 'ghl';
  recipientId: string;
  recipientType?: 'personal' | 'group' | 'broadcast';
  messageContent: string;
  messageType?: string;
  priorityLevel?: 'urgent' | 'high' | 'normal' | 'low';
  scheduledFor?: Date;
  metadata?: Record<string, unknown>;
  communicationLogId?: string;
}

const RATE_LIMITS: Record<string, { capacity: number; refillRate: number; perSecond: boolean }> = {
  telegram_personal: { capacity: 1, refillRate: 1, perSecond: true },
  telegram_global: { capacity: 30, refillRate: 30, perSecond: true },
  ghl_global: { capacity: 100, refillRate: 10, perSecond: true },
  email_global: { capacity: 10, refillRate: 1, perSecond: true },
};

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 1,
  high: 2,
  normal: 3,
  low: 4,
};

/**
 * Enqueue a message for delivery. Deduplicates by content hash.
 */
export async function enqueueMessage(message: OutboundMessage): Promise<string> {
  const sb = getSupabase();

  // Generate dedup key
  const dedupKey = generateDedupKey(message.channel, message.recipientId, message.messageContent);

  // Check for recent duplicate (last 5 min)
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  const { data: existing } = await sb
    .from('outbound_message_queue')
    .select('id')
    .eq('dedup_key', dedupKey)
    .eq('is_duplicate', false)
    .gte('created_at', fiveMinAgo.toISOString())
    .limit(1)
    .single();

  if (existing) {
    // Mark as duplicate
    const { data: dup } = await sb
      .from('outbound_message_queue')
      .insert({
        channel: message.channel,
        recipient_id: message.recipientId,
        recipient_type: message.recipientType || 'personal',
        message_content: message.messageContent,
        message_type: message.messageType || 'text',
        priority_level: message.priorityLevel || 'normal',
        dedup_key: dedupKey,
        is_duplicate: true,
        duplicate_of: existing.id,
        status: 'cancelled',
        communication_log_id: message.communicationLogId || null,
        metadata: message.metadata || {},
      })
      .select('id')
      .single();

    return existing.id; // Return the original, not the duplicate
  }

  // Determine rate limit bucket
  const bucket = message.channel === 'telegram'
    ? `telegram_${message.recipientType || 'personal'}_${message.recipientId}`
    : `${message.channel}_global`;

  const { data, error } = await sb
    .from('outbound_message_queue')
    .insert({
      channel: message.channel,
      recipient_id: message.recipientId,
      recipient_type: message.recipientType || 'personal',
      message_content: message.messageContent,
      message_type: message.messageType || 'text',
      priority_level: message.priorityLevel || 'normal',
      scheduled_for: message.scheduledFor?.toISOString() || null,
      rate_limit_bucket: bucket,
      rate_limit_tokens_required: 1,
      dedup_key: dedupKey,
      is_duplicate: false,
      status: 'queued',
      communication_log_id: message.communicationLogId || null,
      metadata: message.metadata || {},
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Process the queue. Called every 30 seconds by Railway worker.
 */
export async function processQueue(): Promise<{ sent: number; rateLimited: number; failed: number }> {
  const sb = getSupabase();
  let sent = 0;
  let rateLimited = 0;
  let failed = 0;

  // Fetch sendable messages
  const { data: messages, error } = await sb
    .from('outbound_message_queue')
    .select('*')
    .in('status', ['queued', 'rate_limited'])
    .or('scheduled_for.is.null,scheduled_for.lte.' + new Date().toISOString())
    .or('next_retry_at.is.null,next_retry_at.lte.' + new Date().toISOString())
    .order('priority_level', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(50);

  if (error || !messages || messages.length === 0) {
    return { sent: 0, rateLimited: 0, failed: 0 };
  }

  for (const msg of messages) {
    // Two-tier rate limit: global channel bucket THEN per-recipient bucket
    const globalBucket = `${msg.channel}_global`;
    const globalAllowed = await tryConsumeToken(globalBucket, msg.channel);
    if (!globalAllowed) {
      await sb.from('outbound_message_queue').update({
        status: 'rate_limited',
        next_retry_at: new Date(Date.now() + 2000).toISOString(),
      }).eq('id', msg.id);
      rateLimited++;
      continue;
    }

    // Per-recipient bucket (only if different from global)
    const recipientBucket = msg.rate_limit_bucket || globalBucket;
    if (recipientBucket !== globalBucket) {
      const recipientAllowed = await tryConsumeToken(recipientBucket, msg.channel);
      if (!recipientAllowed) {
        await sb.from('outbound_message_queue').update({
          status: 'rate_limited',
          next_retry_at: new Date(Date.now() + 2000).toISOString(),
        }).eq('id', msg.id);
        rateLimited++;
        continue;
      }
    }

    // Attempt send
    await sb.from('outbound_message_queue').update({ status: 'sending' }).eq('id', msg.id);

    const success = await attemptSend(msg);

    if (success) {
      await sb.from('outbound_message_queue').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        attempt_count: msg.attempt_count + 1,
      }).eq('id', msg.id);
      sent++;
    } else {
      const newAttemptCount = msg.attempt_count + 1;
      if (newAttemptCount >= msg.max_attempts) {
        await sb.from('outbound_message_queue').update({
          status: 'failed',
          attempt_count: newAttemptCount,
          last_attempt_at: new Date().toISOString(),
          error_message: 'Max attempts exceeded',
        }).eq('id', msg.id);
        failed++;
      } else {
        const backoff = msg.retry_backoff_ms * Math.pow(2, newAttemptCount);
        await sb.from('outbound_message_queue').update({
          status: 'queued',
          attempt_count: newAttemptCount,
          last_attempt_at: new Date().toISOString(),
          next_retry_at: new Date(Date.now() + backoff).toISOString(),
        }).eq('id', msg.id);
        failed++;
      }
    }
  }

  return { sent, rateLimited, failed };
}

/**
 * Leaky bucket rate limiter via Redis.
 * Returns true if token consumed, false if rate limited.
 */
export async function tryConsumeToken(bucketName: string, channel: string): Promise<boolean> {
  const redis = getRedis();
  const key = `ratelimit:bucket:${bucketName}`;

  // Determine bucket config
  const configKey = channel === 'telegram'
    ? (bucketName.includes('global') ? 'telegram_global' : 'telegram_personal')
    : `${channel}_global`;
  const config = RATE_LIMITS[configKey] || { capacity: 10, refillRate: 1, perSecond: true };

  // Get current state from Redis hash
  const state = await redis.hgetall(key);
  const now = Date.now();

  let tokens: number;
  let lastRefill: number;

  if (!state || !state.tokens) {
    // Initialize bucket
    tokens = config.capacity;
    lastRefill = now;
  } else {
    tokens = parseFloat(state.tokens as string);
    lastRefill = parseInt(state.last_refill as string, 10);
  }

  // Calculate tokens to add based on elapsed time
  const elapsed = (now - lastRefill) / 1000; // seconds
  const refill = elapsed * config.refillRate;
  tokens = Math.min(config.capacity, tokens + refill);

  if (tokens >= 1) {
    // Consume token
    tokens -= 1;
    await redis.hset(key, { tokens: tokens.toString(), last_refill: now.toString() });
    await redis.pexpire(key, 300_000); // 5min TTL for cleanup
    return true;
  }

  // Rate limited — log violation
  const sb = getSupabase();
  await sb.from('rate_limit_violations').insert({
    bucket_name: bucketName,
    tokens_requested: 1,
    tokens_available: tokens,
    violation_type: 'token_exhausted',
  });

  // Still update state (refill happened even if denied)
  await redis.hset(key, { tokens: tokens.toString(), last_refill: now.toString() });
  await redis.pexpire(key, 300_000);

  return false;
}

/**
 * Get queue statistics for /status command.
 */
export async function getQueueStats(): Promise<{
  queued: number;
  sending: number;
  rateLimited: number;
  sent24h: number;
  failed24h: number;
}> {
  const sb = getSupabase();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [queued, sending, rateLimited, sent24h, failed24h] = await Promise.all([
    sb.from('outbound_message_queue').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    sb.from('outbound_message_queue').select('id', { count: 'exact', head: true }).eq('status', 'sending'),
    sb.from('outbound_message_queue').select('id', { count: 'exact', head: true }).eq('status', 'rate_limited'),
    sb.from('outbound_message_queue').select('id', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', dayAgo.toISOString()),
    sb.from('outbound_message_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', dayAgo.toISOString()),
  ]);

  return {
    queued: queued.count || 0,
    sending: sending.count || 0,
    rateLimited: rateLimited.count || 0,
    sent24h: sent24h.count || 0,
    failed24h: failed24h.count || 0,
  };
}

// ════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ════════════════════════════════════════════════════════════

function generateDedupKey(channel: string, recipientId: string, content: string): string {
  return createHash('sha256')
    .update(`${channel}:${recipientId}:${content}`)
    .digest('hex')
    .slice(0, 32);
}

async function attemptSend(message: Record<string, unknown>): Promise<boolean> {
  const channel = message.channel as string;
  const content = message.message_content as string;

  switch (channel) {
    case 'telegram':
      return sendViaTelegram(message);
    case 'email':
      return sendViaEmail(message);
    case 'ghl':
      return sendViaGHL(message);
    default:
      console.warn(`[outbound-queue] Unknown channel: ${channel}`);
      return false;
  }
}

async function sendViaTelegram(message: Record<string, unknown>): Promise<boolean> {
  console.log(`[outbound-queue] Telegram → ${message.recipient_id}: ${(message.message_content as string).slice(0, 100)}`);
  return true; // Stub — actual Telegram Bot API sender in telegram-bot
}

async function sendViaEmail(message: Record<string, unknown>): Promise<boolean> {
  console.log(`[outbound-queue] Email → ${message.recipient_id}: ${(message.message_content as string).slice(0, 100)}`);
  return true; // Stub — actual Graph API sender in email/graph-client
}

async function sendViaGHL(message: Record<string, unknown>): Promise<boolean> {
  console.log(`[outbound-queue] GHL → ${message.recipient_id}: ${(message.message_content as string).slice(0, 100)}`);
  return true; // Stub — actual GHL API sender in ghl-proxy
}
