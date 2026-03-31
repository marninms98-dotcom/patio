// ════════════════════════════════════════════════════════════
// Telegram Group Monitor
//
// Processes group chat messages — observe and learn, respond
// only if @mentioned. Called via HTTP POST from the existing
// telegram-bot Edge Function deployed separately.
//
// Exports handleGroupMessage() for Railway's express/fastify server.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { generateEmbedding } from '../utils/embeddings.js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const JOB_REF_REGEX = /\bSWP-\d{5}\b/gi;

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

// ── Telegram Bot API Message interface ──
export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: 'group' | 'supergroup' | 'private' | 'channel';
    title?: string;
  };
  from?: {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
  };
  text?: string;
  entities?: Array<{
    type: string;
    offset: number;
    length: number;
    user?: { id: number; username?: string };
  }>;
}

export interface EntityMatch {
  type: 'staff' | 'client' | 'job' | 'entity';
  id?: string;
  name: string;
  confidence: number;
}

export interface ActionableInfo {
  category: 'schedule_change' | 'material_issue' | 'completion' | 'problem';
  severity: 'low' | 'medium' | 'high';
  matched_text: string;
  keywords: string[];
}

// ── Actionable info patterns ──
const ACTIONABLE_PATTERNS: Array<{
  category: ActionableInfo['category'];
  severity: ActionableInfo['severity'];
  patterns: RegExp[];
}> = [
  {
    category: 'schedule_change',
    severity: 'medium',
    patterns: [
      /\b(?:running late|delayed|moved to|rescheduled|pushed back|brought forward|postponed)\b/i,
    ],
  },
  {
    category: 'material_issue',
    severity: 'high',
    patterns: [
      /\b(?:out of stock|back ?ordered|wrong colou?r|damaged|short ?shipped|missing|defective)\b/i,
    ],
  },
  {
    category: 'completion',
    severity: 'low',
    patterns: [
      /\b(?:finished|done|completed|all good|wrapped up|signed off|handed over)\b/i,
    ],
  },
  {
    category: 'problem',
    severity: 'high',
    patterns: [
      /\b(?:issue|problem|broken|wrong|complaint|leak|crack|not right|stuffed|buggered)\b/i,
    ],
  },
];

/**
 * Process a group chat message.
 * Called by Railway's HTTP server when telegram-bot forwards group messages.
 */
export async function handleGroupMessage(message: TelegramMessage): Promise<void> {
  if (!message.text || !message.from) return;

  const sb = getSupabase();
  const text = message.text;

  // ── Step 1: Log to communications_log ──
  const senderEntityId = await resolveSenderEntity(sb, message.from);

  const embedding = await generateEmbedding(text).catch(() => null);
  const commRow: Record<string, unknown> = {
    org_id: DEFAULT_ORG_ID,
    channel: 'telegram',
    sender_entity_id: senderEntityId,
    group_id: String(message.chat.id),
    content_text: text,
    source_message_id: String(message.message_id),
    is_inbound: true,
    metadata: {
      chat_title: message.chat.title,
      sender_username: message.from.username,
      sender_name: `${message.from.first_name} ${message.from.last_name || ''}`.trim(),
    },
  };
  if (embedding) {
    commRow.embedding = `[${embedding.join(',')}]`;
  }

  await sb.from('communications_log').insert(commRow);

  // ── Step 2: Extract entities ──
  const entities = await extractEntities(text);

  // ── Step 3: Detect actionable info ──
  const actionable = detectActionableInfo(text);

  // ── Step 4: Store observations if actionable ──
  if (actionable) {
    const observationContent = `[${actionable.category}] ${message.from.first_name}: "${actionable.matched_text}" in group ${message.chat.title || message.chat.id}`;

    // Find related entity — prefer job match, then any entity match
    const targetEntityId =
      entities.find((e) => e.type === 'job')?.id ||
      entities.find((e) => e.id)?.id ||
      senderEntityId;

    if (targetEntityId) {
      const obsEmbedding = await generateEmbedding(observationContent).catch(() => null);
      const obsRow: Record<string, unknown> = {
        org_id: DEFAULT_ORG_ID,
        entity_id: targetEntityId,
        observation_type: actionable.severity === 'high' ? 'issue' : 'interaction',
        content: observationContent,
        source_channel: 'telegram',
        confidence: 0.75,
        visibility_scope: 'role_restricted',
        visible_to_roles: ['admin', 'estimator'],
      };
      if (obsEmbedding) {
        obsRow.embedding = `[${obsEmbedding.join(',')}]`;
      }

      await sb.from('entity_observations').insert(obsRow);
    }
  }

  // ── Step 5: Check if bot @mentioned ──
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'jarvis_bot';
  const isMentioned =
    message.entities?.some(
      (e) =>
        e.type === 'mention' &&
        text.substring(e.offset, e.offset + e.length).toLowerCase() === `@${botUsername.toLowerCase()}`,
    ) || false;

  if (isMentioned) {
    // Process as direct query — the caller (Railway HTTP handler)
    // should route the response back to the group chat
    // This will be wired to the orchestrator in the HTTP handler
    console.log(`Bot mentioned in group ${message.chat.id} by ${message.from.username}: ${text}`);
  }
}

/**
 * Extract entity references from message text.
 */
export async function extractEntities(text: string): Promise<EntityMatch[]> {
  const sb = getSupabase();
  const matches: EntityMatch[] = [];

  // Match job references (SWP-XXXXX)
  const jobRefs = text.match(JOB_REF_REGEX);
  if (jobRefs) {
    for (const ref of jobRefs) {
      matches.push({ type: 'job', name: ref, confidence: 1.0 });
    }
  }

  // Match @mentions against staff_agent_preferences
  const mentionRegex = /@(\w+)/g;
  let mentionMatch;
  while ((mentionMatch = mentionRegex.exec(text)) !== null) {
    const username = mentionMatch[1];
    const { data: staff } = await sb
      .from('staff_agent_preferences')
      .select('entity_id, display_name')
      .eq('is_active', true);

    // Check if any staff username matches (stored in entity_profiles metadata)
    if (staff) {
      for (const s of staff) {
        if (s.display_name.toLowerCase().includes(username.toLowerCase())) {
          matches.push({
            type: 'staff',
            id: s.entity_id,
            name: s.display_name,
            confidence: 0.8,
          });
        }
      }
    }
  }

  // Fuzzy match names against entity_profiles (pg_trgm)
  // Extract capitalized words that look like names (2+ words, each 2+ chars)
  const nameRegex = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let nameMatch;
  while ((nameMatch = nameRegex.exec(text)) !== null) {
    const possibleName = nameMatch[1];
    const { data: fuzzyResults } = await sb.rpc('search_entities', {
      p_org_id: DEFAULT_ORG_ID,
      p_query: possibleName,
      p_entity_type: null,
      p_limit: 1,
    });

    if (fuzzyResults && fuzzyResults.length > 0 && fuzzyResults[0].similarity_score > 0.4) {
      matches.push({
        type: 'entity',
        id: fuzzyResults[0].id,
        name: fuzzyResults[0].name,
        confidence: fuzzyResults[0].similarity_score,
      });
    }
  }

  return matches;
}

/**
 * Detect actionable information in message text.
 */
export function detectActionableInfo(text: string): ActionableInfo | null {
  for (const def of ACTIONABLE_PATTERNS) {
    for (const pattern of def.patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          category: def.category,
          severity: def.severity,
          matched_text: match[0],
          keywords: [match[0].toLowerCase()],
        };
      }
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════

async function resolveSenderEntity(
  sb: SupabaseClient,
  from: NonNullable<TelegramMessage['from']>,
): Promise<string | null> {
  // Try staff_agent_preferences first
  const { data: staff } = await sb
    .from('staff_agent_preferences')
    .select('entity_id')
    .eq('telegram_user_id', from.id)
    .single();

  if (staff?.entity_id) return staff.entity_id;

  // Try fuzzy match on entity_profiles by name
  const fullName = `${from.first_name} ${from.last_name || ''}`.trim();
  const { data: fuzzy } = await sb.rpc('search_entities', {
    p_org_id: DEFAULT_ORG_ID,
    p_query: fullName,
    p_entity_type: null,
    p_limit: 1,
  });

  if (fuzzy && fuzzy.length > 0 && fuzzy[0].similarity_score > 0.5) {
    return fuzzy[0].id;
  }

  return null;
}
