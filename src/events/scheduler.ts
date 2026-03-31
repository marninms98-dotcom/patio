// ════════════════════════════════════════════════════════════
// Scheduler — Node.js cron scheduler running on Railway
//
// NOT pg_cron. Polls scheduled_triggers every 60 seconds,
// fires due triggers by enqueuing events.
// Uses cron-parser for next-fire calculation in Australia/Perth.
// ════════════════════════════════════════════════════════════

import { parseExpression } from 'cron-parser';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { enqueueEvent } from './event-queue.js';

let _sb: SupabaseClient | null = null;
let _interval: ReturnType<typeof setInterval> | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Start the scheduler. Runs checkSchedules() every 60 seconds.
 */
export function startScheduler(): void {
  if (_interval) {
    console.warn('Scheduler already running');
    return;
  }

  console.log('[scheduler] Starting — checking every 60s');

  // Run immediately on startup
  checkSchedules().catch((err) => console.error('[scheduler] Error:', err));

  _interval = setInterval(() => {
    checkSchedules().catch((err) => console.error('[scheduler] Error:', err));
  }, 60_000);
}

/**
 * Stop the scheduler.
 */
export function stopScheduler(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
    console.log('[scheduler] Stopped');
  }
}

/**
 * Check all scheduled triggers and fire those that are due.
 */
export async function checkSchedules(): Promise<void> {
  const sb = getSupabase();

  const { data: triggers, error } = await sb
    .from('scheduled_triggers')
    .select('*')
    .eq('enabled', true)
    .or(`next_fire_at.is.null,next_fire_at.lte.${new Date().toISOString()}`);

  if (error || !triggers || triggers.length === 0) return;

  for (const trigger of triggers) {
    try {
      // Enqueue the event
      await enqueueEvent(
        trigger.event_type,
        'scheduler',
        trigger.payload || {},
        50, // normal priority for scheduled events
      );

      // Calculate next fire time
      const nextFire = calculateNextFire(trigger.cron_expression, trigger.timezone);

      // Update trigger
      await sb
        .from('scheduled_triggers')
        .update({
          last_fired_at: new Date().toISOString(),
          next_fire_at: nextFire.toISOString(),
        })
        .eq('id', trigger.id);

      console.log(`[scheduler] Fired: ${trigger.name}, next: ${nextFire.toISOString()}`);
    } catch (err) {
      console.error(`[scheduler] Failed to fire ${trigger.name}:`, err);
    }
  }
}

/**
 * Calculate the next fire time for a cron expression in a given timezone.
 */
export function calculateNextFire(cronExpression: string, timezone: string = 'Australia/Perth'): Date {
  const interval = parseExpression(cronExpression, {
    tz: timezone,
    currentDate: new Date(),
  });
  return interval.next().toDate();
}
