// ════════════════════════════════════════════════════════════
// Persona Compiler — Dynamic system prompt generation
//
// Merges: persona config + entity memory + conversation context
// into a compiled system prompt string for LLM calls.
// Redis-cached (5min TTL).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getCache, setCache } from '../utils/redis.js';
import { execute as searchMemory } from '../tools/memory/search-memory.js';
import { PERSONA_CONFIGS, PersonaConfig } from './persona-configs.js';

const CACHE_TTL_MS = 300_000; // 5 minutes

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Compile a dynamic system prompt for a specific entity and persona.
 */
export async function compilePersona(
  entityId: string,
  personaType: string,
  conversationContext?: string,
): Promise<string> {
  // Check Redis cache
  const cacheKey = `persona:compiled:${entityId}`;
  const cached = await getCache<string>(cacheKey);
  if (cached && !conversationContext) return cached;

  // Load persona config (Redis → DB → hardcoded fallback)
  const config = await loadPersonaConfig(personaType);

  // Load entity record
  const sb = getSupabase();
  const { data: entity } = await sb
    .from('entity_profiles')
    .select('name, entity_type, facts, relationships')
    .eq('id', entityId)
    .single();

  // Load entity memory (communication preferences, relationship history, recent interactions)
  let memoryContext = '';
  try {
    const memoryResults = await searchMemory({
      query: `communication preferences relationship history recent interactions for ${entity?.name || 'entity'}`,
      entity_id: entityId,
    });
    if (memoryResults.results.length > 0) {
      memoryContext = memoryResults.results
        .slice(0, 5)
        .map((r) => `- [${r.observation_type}] ${r.content}`)
        .join('\n');
    }
  } catch {
    // Memory search may fail — proceed without it
  }

  // Compile the prompt
  const parts: string[] = [];

  // Base persona instructions
  parts.push(`## Persona: ${config.displayName}`);
  parts.push(`Tone: ${config.tone} | Formality: ${config.formalityLevel} | Length: ${config.responseLength}`);
  parts.push(`Traits: ${config.keyTraits.join(', ')}`);
  parts.push(`Greeting: ${config.greetingStyle}`);
  parts.push(`Closing: ${config.closingStyle}`);
  parts.push(`Decision guidance: ${config.decisionMakingGuidance}`);
  parts.push(`Expertise deference: ${config.expertiseDeference}`);
  parts.push(`Uncertainty: ${config.uncertaintyHandling}`);

  if (config.cultureNotes) {
    parts.push(`Culture: ${config.cultureNotes}`);
  }

  // Entity-specific context
  if (entity) {
    parts.push(`\n## About ${entity.name}`);
    parts.push(`Type: ${entity.entity_type}`);

    if (entity.facts && Object.keys(entity.facts).length > 0) {
      parts.push('Known facts:');
      for (const [key, value] of Object.entries(entity.facts)) {
        parts.push(`- ${key}: ${value}`);
      }
    }
  }

  // Memory context
  if (memoryContext) {
    parts.push('\n## Recent History');
    parts.push(memoryContext);
  }

  // Conversation context
  if (conversationContext) {
    parts.push('\n## Current Conversation Context');
    parts.push(conversationContext);
  }

  // AI disclosure
  if (config.aiDisclosureRequired) {
    const disclosureText = (config.metadata as any)?.disclosureText || 'Assisted by AI';
    parts.push(`\n## IMPORTANT: AI Disclosure Required`);
    parts.push(`Include "${disclosureText}" as a footnote in all client-facing communications.`);
  }

  const compiled = parts.join('\n');

  // Cache (only if no conversation-specific context, since that changes per message)
  if (!conversationContext) {
    await setCache(cacheKey, compiled, CACHE_TTL_MS);
  }

  return compiled;
}

/**
 * Resolve the persona type for an entity.
 * Checks entity_profiles.persona_type, infers from entity_type, defaults to 'client'.
 */
export async function resolvePersonaType(entityId: string): Promise<string> {
  const sb = getSupabase();

  const { data } = await sb
    .from('entity_profiles')
    .select('persona_type, entity_type')
    .eq('id', entityId)
    .single();

  // Explicit persona_type set
  if (data?.persona_type) return data.persona_type;

  // Infer from entity_type
  if (data?.entity_type) {
    switch (data.entity_type) {
      case 'staff_member': return 'staff';
      case 'installer': return 'crew';
      case 'supplier': return 'supplier';
      case 'client': return 'client';
    }
  }

  return 'client'; // Default
}

/**
 * Load a persona config. Redis → DB → hardcoded fallback.
 */
async function loadPersonaConfig(personaType: string): Promise<PersonaConfig> {
  // Try Redis cache
  const cacheKey = `persona:config:${personaType}`;
  const cached = await getCache<PersonaConfig>(cacheKey);
  if (cached) return cached;

  // Try DB
  const sb = getSupabase();
  const { data } = await sb
    .from('persona_configs')
    .select('*')
    .eq('persona_type', personaType)
    .single();

  if (data) {
    const config: PersonaConfig = {
      personaType: data.persona_type,
      displayName: data.display_name,
      description: data.description,
      tone: data.tone,
      keyTraits: data.key_traits || [],
      responseLength: data.response_length,
      emojiUsage: data.emoji_usage,
      formalityLevel: data.formality_level,
      greetingStyle: data.greeting_style,
      closingStyle: data.closing_style,
      decisionMakingGuidance: data.decision_making_guidance,
      expertiseDeference: data.expertise_deference,
      uncertaintyHandling: data.uncertainty_handling,
      cultureNotes: data.culture_notes,
      aiDisclosureRequired: data.ai_disclosure_required,
      metadata: data.metadata,
    };
    await setCache(cacheKey, config, CACHE_TTL_MS);
    return config;
  }

  // Hardcoded fallback
  return PERSONA_CONFIGS[personaType] || PERSONA_CONFIGS['client'];
}
