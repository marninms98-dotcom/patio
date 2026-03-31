// ════════════════════════════════════════════════════════════
// Event Queue — Central event processing with concurrency safety
//
// Uses FOR UPDATE SKIP LOCKED for concurrent-safe dequeue.
// Priority: 0=critical, 25=high, 50=normal, 75=low, 100=background.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

export interface QueuedEvent {
  id: string;
  event_type: string;
  source: string;
  payload: Record<string, unknown>;
  priority: number;
  status: string;
  retry_count: number;
  max_retries: number;
  scheduled_for: string;
  locked_by: string | null;
  locked_at: string | null;
  created_at: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  failed: number;
  dead_letter: number;
}

/**
 * Enqueue an event for processing.
 */
export async function enqueueEvent(
  eventType: string,
  source: string,
  payload: Record<string, unknown> = {},
  priority: number = 50,
  scheduledFor?: Date,
): Promise<string> {
  const sb = getSupabase();

  const { data, error } = await sb
    .from('event_queue')
    .insert({
      event_type: eventType,
      source,
      payload,
      priority,
      scheduled_for: scheduledFor?.toISOString() || new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Dequeue next event for processing.
 * Uses FOR UPDATE SKIP LOCKED for concurrent safety.
 * Lock TTL: 5 minutes.
 */
export async function dequeueNext(workerId: string): Promise<QueuedEvent | null> {
  const sb = getSupabase();

  // Raw SQL for FOR UPDATE SKIP LOCKED — not available via PostgREST
  const { data, error } = await sb.rpc('dequeue_next_event', {
    p_worker_id: workerId,
    p_lock_ttl_seconds: 300,
  });

  if (error) {
    // RPC may not exist yet — fall back to non-locking query
    console.warn('dequeue_next_event RPC unavailable, using fallback:', error.message);
    return dequeueFallback(workerId);
  }

  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  return Array.isArray(data) ? data[0] : data;
}

/**
 * Fallback dequeue without FOR UPDATE SKIP LOCKED.
 * Less safe for concurrency but works without custom RPC.
 */
async function dequeueFallback(workerId: string): Promise<QueuedEvent | null> {
  const sb = getSupabase();

  const { data: events } = await sb
    .from('event_queue')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('priority', { ascending: true })
    .order('scheduled_for', { ascending: true })
    .limit(1);

  if (!events || events.length === 0) return null;

  const event = events[0];

  // Optimistic lock
  const { data: locked, error } = await sb
    .from('event_queue')
    .update({
      status: 'processing',
      locked_by: workerId,
      locked_at: new Date().toISOString(),
    })
    .eq('id', event.id)
    .eq('status', 'pending') // CAS — only if still pending
    .select()
    .single();

  if (error || !locked) return null; // Someone else grabbed it
  return locked;
}

/**
 * Mark event as completed.
 */
export async function completeEvent(eventId: string, result?: unknown): Promise<void> {
  const sb = getSupabase();

  await sb
    .from('event_queue')
    .update({
      status: 'completed',
      processed_at: new Date().toISOString(),
      locked_by: null,
      locked_at: null,
    })
    .eq('id', eventId);
}

/**
 * Mark event as failed with retry or dead letter.
 */
export async function failEvent(eventId: string, error: string): Promise<void> {
  const sb = getSupabase();

  // Fetch current state
  const { data: event } = await sb
    .from('event_queue')
    .select('retry_count, max_retries')
    .eq('id', eventId)
    .single();

  if (!event) return;

  const newRetryCount = event.retry_count + 1;

  if (newRetryCount >= event.max_retries) {
    // Dead letter
    await sb
      .from('event_queue')
      .update({
        status: 'dead_letter',
        retry_count: newRetryCount,
        error_message: error,
        locked_by: null,
        locked_at: null,
      })
      .eq('id', eventId);
  } else {
    // Retry with exponential backoff: 30s * 2^retry
    const backoffMs = 30_000 * Math.pow(2, newRetryCount);
    const retryAt = new Date(Date.now() + backoffMs);

    await sb
      .from('event_queue')
      .update({
        status: 'pending',
        retry_count: newRetryCount,
        error_message: error,
        scheduled_for: retryAt.toISOString(),
        locked_by: null,
        locked_at: null,
      })
      .eq('id', eventId);
  }
}

/**
 * Cleanup stale locks (events stuck in 'processing' too long).
 */
export async function cleanupStaleLocks(maxAgeMs: number = 300_000): Promise<number> {
  const sb = getSupabase();
  const cutoff = new Date(Date.now() - maxAgeMs);

  const { data } = await sb
    .from('event_queue')
    .update({
      status: 'pending',
      locked_by: null,
      locked_at: null,
    })
    .eq('status', 'processing')
    .lt('locked_at', cutoff.toISOString())
    .select('id');

  return data?.length || 0;
}

/**
 * Get queue statistics for /status command.
 */
export async function getQueueStats(): Promise<QueueStats> {
  const sb = getSupabase();

  const counts = await Promise.all([
    sb.from('event_queue').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    sb.from('event_queue').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
    sb.from('event_queue').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    sb.from('event_queue').select('id', { count: 'exact', head: true }).eq('status', 'dead_letter'),
  ]);

  return {
    pending: counts[0].count || 0,
    processing: counts[1].count || 0,
    failed: counts[2].count || 0,
    dead_letter: counts[3].count || 0,
  };
}
