// ════════════════════════════════════════════════════════════
// Email Processor
//
// Processes inbound emails into the memory system.
// Classifies intent via Claude Haiku, extracts entities,
// stores observations, routes actionable items.
// ════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '../../utils/embeddings.js';
import { processIntention } from '../../orchestrator/index.js';
import { GraphMessage } from './graph-client.js';
import { EntityMatch } from '../telegram-group.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const JOB_REF_REGEX = /\bSWP-\d{5}\b/gi;
const DOLLAR_REGEX = /\$\s?[\d,]+(?:\.\d{2})?/g;
const DATE_REGEX = /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g;

const HTML_ENTITY_MAP: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
  '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
};

/**
 * Strip HTML tags and decode common entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // remove style blocks
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // remove script blocks
    .replace(/<br\s*\/?>/gi, '\n') // br → newline
    .replace(/<\/p>/gi, '\n\n') // closing p → double newline
    .replace(/<[^>]+>/g, '') // strip remaining tags
    .replace(/&\w+;|&#\d+;/g, (entity) => HTML_ENTITY_MAP[entity] || entity)
    .replace(/\n{3,}/g, '\n\n') // collapse excessive newlines
    .trim();
}

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

export interface EmailClassification {
  intent: string;
  confidence: number;
  key_entities: string[];
  amounts: number[];
  dates: string[];
}

export interface ProcessedEmail {
  messageId: string;
  classification: EmailClassification;
  entities: EntityMatch[];
  observationsStored: number;
  actionTaken: string | null;
}

/**
 * Process an inbound email through classification → extraction → storage → routing.
 */
export async function processInboundEmail(email: GraphMessage): Promise<ProcessedEmail> {
  const sb = getSupabase();

  const subject = email.subject || '';
  const rawBody = email.body?.content || email.bodyPreview || '';
  const body = email.body?.contentType === 'html' ? stripHtml(rawBody) : rawBody;
  const senderEmail = email.from?.emailAddress?.address || '';
  const senderName = email.from?.emailAddress?.name || '';

  // ── Step 1: Log to communications_log ──
  const senderEntityId = await resolveEmailSender(sb, senderEmail, senderName);

  const embedding = await generateEmbedding(`${subject} ${body}`).catch(() => null);
  const commRow: Record<string, unknown> = {
    org_id: DEFAULT_ORG_ID,
    channel: 'email',
    sender_entity_id: senderEntityId,
    content_text: `Subject: ${subject}\n\n${body}`,
    content_summary: subject,
    source_message_id: email.id,
    thread_id: email.conversationId || null,
    is_inbound: true,
    metadata: {
      from: email.from?.emailAddress,
      to: email.toRecipients?.map((r) => r.emailAddress),
      has_attachments: email.hasAttachments,
      received_at: email.receivedDateTime,
    },
  };
  if (embedding) {
    commRow.embedding = `[${embedding.join(',')}]`;
  }

  await sb.from('communications_log').insert(commRow);

  // ── Step 2: Classify intent via Claude Haiku ──
  const classification = await classifyEmailIntent(subject, body);

  // ── Step 3: Extract entities ──
  const entities = await extractEmailEntities(email);

  // ── Step 4: Store observations ──
  let observationsStored = 0;

  if (senderEntityId && classification.intent !== 'spam') {
    const obsContent = `Email from ${senderName}: [${classification.intent}] ${subject}`;
    const obsEmbedding = await generateEmbedding(obsContent).catch(() => null);
    const obsRow: Record<string, unknown> = {
      org_id: DEFAULT_ORG_ID,
      entity_id: senderEntityId,
      observation_type: 'interaction',
      content: obsContent,
      source_channel: 'system',
      confidence: classification.confidence,
      visibility_scope: 'role_restricted',
      visible_to_roles: ['admin', 'estimator'],
    };
    if (obsEmbedding) {
      obsRow.embedding = `[${obsEmbedding.join(',')}]`;
    }

    await sb.from('entity_observations').insert(obsRow);
    observationsStored++;
  }

  // ── Step 5: Route actionable items ──
  let actionTaken: string | null = null;

  switch (classification.intent) {
    case 'enquiry':
    case 'quote_request': {
      // Create lead thread
      await sb.from('active_threads').insert({
        thread_type: classification.intent === 'enquiry' ? 'lead_chase' : 'quote_followup',
        subject_entity_id: senderEntityId,
        context_summary: `${classification.intent}: ${subject}`,
        next_action_date: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // 4h from now
        metadata: {
          source: 'email',
          email_id: email.id,
          classification,
        },
      });
      actionTaken = `Created ${classification.intent} thread`;
      break;
    }

    case 'complaint': {
      // Immediate escalation via orchestrator (L4)
      await processIntention({
        channel: 'system',
        raw_input: `COMPLAINT from ${senderName}: ${subject}`,
        detected_intent: 'escalate_complaint',
        confidence: classification.confidence,
        parsed_params: {
          sender: senderName,
          email: senderEmail,
          subject,
          email_id: email.id,
        },
      });
      actionTaken = 'Escalated complaint (L4)';
      break;
    }

    case 'payment_notification': {
      // Log for now — Xero integration is Phase 5
      if (senderEntityId) {
        await sb.from('entity_observations').insert({
          org_id: DEFAULT_ORG_ID,
          entity_id: senderEntityId,
          observation_type: 'fact',
          content: `Payment notification received: ${subject}. Amounts: ${classification.amounts.join(', ') || 'not extracted'}`,
          source_channel: 'system',
          confidence: 0.70,
          visibility_scope: 'role_restricted',
          visible_to_roles: ['admin'],
        });
        observationsStored++;
      }
      actionTaken = 'Logged payment notification (Xero integration Phase 5)';
      break;
    }

    case 'supplier_correspondence': {
      actionTaken = 'Logged supplier email';
      break;
    }

    default:
      break;
  }

  return {
    messageId: email.id,
    classification,
    entities,
    observationsStored,
    actionTaken,
  };
}

/**
 * Classify email intent using Claude Haiku for speed/cost.
 */
export async function classifyEmailIntent(
  subject: string,
  body: string,
): Promise<EmailClassification> {
  const anthropic = getAnthropic();

  const truncatedBody = body.slice(0, 2000); // Limit to keep costs down

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Classify this email for a patio construction company (SecureWorks WA). Output JSON only.

Categories: enquiry, quote_request, complaint, payment_notification, supplier_correspondence, council_notice, warranty_claim, general, spam

Output format: { "intent": "category", "confidence": 0.0-1.0, "key_entities": ["name1", ...], "amounts": [1234.56, ...], "dates": ["2024-03-15", ...] }

Subject: ${subject}
Body: ${truncatedBody}`,
        },
      ],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    return JSON.parse(text);
  } catch (err) {
    console.error('Email classification failed:', err);
    return {
      intent: 'general',
      confidence: 0.3,
      key_entities: [],
      amounts: [],
      dates: [],
    };
  }
}

/**
 * Extract entity references from an email.
 */
export async function extractEmailEntities(email: GraphMessage): Promise<EntityMatch[]> {
  const sb = getSupabase();
  const matches: EntityMatch[] = [];
  const fullText = `${email.subject || ''} ${email.bodyPreview || ''}`;

  // Job references
  const jobRefs = fullText.match(JOB_REF_REGEX);
  if (jobRefs) {
    for (const ref of jobRefs) {
      matches.push({ type: 'job', name: ref, confidence: 1.0 });
    }
  }

  // Sender as entity
  const senderName = email.from?.emailAddress?.name;
  if (senderName) {
    const { data: fuzzy } = await sb.rpc('search_entities', {
      p_org_id: DEFAULT_ORG_ID,
      p_query: senderName,
      p_entity_type: null,
      p_limit: 1,
    });

    if (fuzzy && fuzzy.length > 0 && fuzzy[0].similarity_score > 0.4) {
      matches.push({
        type: 'entity',
        id: fuzzy[0].id,
        name: fuzzy[0].name,
        confidence: fuzzy[0].similarity_score,
      });
    }
  }

  return matches;
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function resolveEmailSender(
  sb: SupabaseClient,
  email: string,
  name: string,
): Promise<string | null> {
  if (!email) return null;

  // Try fuzzy match by name
  if (name) {
    const { data: fuzzy } = await sb.rpc('search_entities', {
      p_org_id: DEFAULT_ORG_ID,
      p_query: name,
      p_entity_type: null,
      p_limit: 1,
    });

    if (fuzzy && fuzzy.length > 0 && fuzzy[0].similarity_score > 0.5) {
      return fuzzy[0].id;
    }
  }

  return null;
}
