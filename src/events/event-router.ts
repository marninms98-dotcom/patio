// ════════════════════════════════════════════════════════════
// Event Router — Routes events from queue to handlers
// ════════════════════════════════════════════════════════════

import { QueuedEvent } from './event-queue.js';
import { processIntention } from '../orchestrator/index.js';
import { runNightlyConsolidation } from '../workers/memory-consolidation.js';
import { handleGroupMessage } from '../channels/telegram-group.js';
import { processInboundEmail } from '../channels/email/email-processor.js';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Route an event to the appropriate handler.
 */
export async function routeEvent(event: QueuedEvent): Promise<void> {
  switch (event.event_type) {
    case 'webhook_ghl':
      await handleGhlWebhook(event.payload);
      break;

    case 'payment_xero':
      await handleXeroPayment(event.payload);
      break;

    case 'email_inbound':
      await processInboundEmail(event.payload as any);
      break;

    case 'telegram_group':
      await handleGroupMessage(event.payload as any);
      break;

    case 'schedule_trigger':
      await handleScheduledAction(event.payload);
      break;

    case 'thread_due':
      await handleThreadDue(event.payload);
      break;

    case 'status_change':
      await handleStateChange(event.payload);
      break;

    default:
      console.warn(`Unknown event type: ${event.event_type}`);
  }
}

/**
 * Handle scheduled actions from cron triggers.
 */
export async function handleScheduledAction(payload: Record<string, unknown>): Promise<void> {
  const action = payload.action as string;

  switch (action) {
    case 'morning_brief':
      await processIntention({
        channel: 'cron',
        raw_input: 'Generate morning briefing',
        detected_intent: 'send_daily_digest',
        confidence: 1.0,
        parsed_params: { type: 'morning_brief' },
      });
      break;

    case 'process_actions':
      await processIntention({
        channel: 'cron',
        raw_input: 'Mid-morning lead chase cycle',
        detected_intent: 'send_stage1_chase',
        confidence: 1.0,
        parsed_params: { type: 'process_actions' },
      });
      break;

    case 'afternoon_review':
      await processIntention({
        channel: 'cron',
        raw_input: 'Afternoon pipeline review',
        detected_intent: 'send_daily_digest',
        confidence: 1.0,
        parsed_params: { type: 'afternoon_review' },
      });
      break;

    case 'eod_summary':
      await processIntention({
        channel: 'cron',
        raw_input: 'End of day summary',
        detected_intent: 'send_daily_digest',
        confidence: 1.0,
        parsed_params: { type: 'eod_summary' },
      });
      break;

    case 'memory_consolidation':
      await runNightlyConsolidation();
      break;

    case 'overdue_check':
      await processIntention({
        channel: 'cron',
        raw_input: 'Check overdue commitments and threads',
        detected_intent: 'read_job_details',
        confidence: 1.0,
        parsed_params: { type: 'overdue_check' },
      });
      break;

    case 'thread_due_scan':
      // Import dynamically to avoid circular deps
      const { scanDueThreads } = await import('../threads/thread-manager.js');
      await scanDueThreads();
      break;

    default:
      console.warn(`Unknown scheduled action: ${action}`);
  }
}

/**
 * Handle state change events (invoice_overdue, quote_expired, etc.).
 */
export async function handleStateChange(payload: Record<string, unknown>): Promise<void> {
  const changeType = payload.change_type as string;

  switch (changeType) {
    case 'invoice_overdue': {
      await processIntention({
        channel: 'system',
        raw_input: `Invoice overdue: ${payload.invoice_id}`,
        detected_intent: 'send_stage1_chase',
        confidence: 0.9,
        parsed_params: payload,
      });
      break;
    }

    case 'quote_expired': {
      await processIntention({
        channel: 'system',
        raw_input: `Quote expired for job ${payload.job_id}`,
        detected_intent: 'send_stage2_chase',
        confidence: 0.85,
        parsed_params: payload,
      });
      break;
    }

    case 'job_milestone': {
      await processIntention({
        channel: 'system',
        raw_input: `Job milestone: ${payload.milestone} for ${payload.job_id}`,
        detected_intent: 'send_progress_update',
        confidence: 0.9,
        parsed_params: payload,
      });
      break;
    }

    case 'payment_received': {
      await processIntention({
        channel: 'system',
        raw_input: `Payment received: $${payload.amount} for job ${payload.job_id}`,
        detected_intent: 'update_job_status',
        confidence: 0.95,
        parsed_params: payload,
      });
      break;
    }

    default:
      console.warn(`Unknown state change: ${changeType}`);
  }
}

/**
 * Handle GHL webhook events.
 */
async function handleGhlWebhook(payload: Record<string, unknown>): Promise<void> {
  await processIntention({
    channel: 'api',
    raw_input: `GHL webhook: ${payload.event || 'unknown'}`,
    detected_intent: 'read_contact',
    confidence: 0.8,
    parsed_params: payload,
  });
}

/**
 * Handle Xero payment events.
 */
async function handleXeroPayment(payload: Record<string, unknown>): Promise<void> {
  await processIntention({
    channel: 'api',
    raw_input: `Xero payment: ${payload.invoice_id || 'unknown'}`,
    detected_intent: 'update_job_status',
    confidence: 0.9,
    parsed_params: payload,
  });
}

/**
 * Handle thread due events.
 */
async function handleThreadDue(payload: Record<string, unknown>): Promise<void> {
  const { getDueThreads, processThread } = await import('../threads/thread-manager.js');
  const dueThreads = await getDueThreads();

  for (const thread of dueThreads) {
    try {
      await processThread(thread);
    } catch (err) {
      console.error(`Failed to process thread ${thread.id}:`, err);
    }
  }
}
