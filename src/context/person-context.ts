// ════════════════════════════════════════════════════════════
// Person Context Builder
//
// Compiles personalised context for each person JARVIS
// interacts with. Used for LLM prompt injection so JARVIS
// responds appropriately per staff member.
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

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

export interface StaffAgentPreferences {
  id: string;
  telegram_user_id: number;
  entity_id: string | null;
  display_name: string;
  role: string;
  notification_preferences: Record<string, boolean>;
  communication_style: string;
  areas_of_responsibility: string[];
  delegated_authority_level: number;
  is_active: boolean;
  onboarded: boolean;
  timezone: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
}

export interface EntityObservation {
  observation_type: string;
  content: string;
  confidence: number;
  observed_at: string;
}

export interface ActiveThread {
  id: string;
  thread_type: string;
  context_summary: string;
  current_step: number;
  status: string;
  next_action_date: string | null;
}

export interface SeasonalContext {
  month: number;
  season_name: string;
  demand_multiplier: number;
  lead_followup_urgency: string;
  scheduling_notes: string | null;
  material_notes: string | null;
}

export interface PersonContext {
  staffProfile: StaffAgentPreferences;
  recentObservations: EntityObservation[];
  activeThreads: ActiveThread[];
  seasonalContext: SeasonalContext;
  compiledContextString: string;
}

/**
 * Build personalised context for a person by Telegram user ID.
 * If not found, triggers onboarding flow.
 */
export async function getPersonContext(telegramUserId: number): Promise<PersonContext | null> {
  const sb = getSupabase();

  // ── Step 1: Look up staff preferences ──
  const { data: staff, error } = await sb
    .from('staff_agent_preferences')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (error || !staff) {
    return null; // Caller should trigger onboarding
  }

  // ── Step 2: Recent observations (last 7 days) ──
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  let recentObservations: EntityObservation[] = [];
  if (staff.entity_id) {
    const { data: obs } = await sb
      .from('entity_observations')
      .select('observation_type, content, confidence, observed_at')
      .eq('entity_id', staff.entity_id)
      .eq('is_active', true)
      .gte('observed_at', weekAgo.toISOString())
      .order('observed_at', { ascending: false })
      .limit(10);

    recentObservations = obs || [];
  }

  // ── Step 3: Active threads they're involved in ──
  let activeThreads: ActiveThread[] = [];
  if (staff.entity_id) {
    const { data: threads } = await sb
      .from('active_threads')
      .select('id, thread_type, context_summary, current_step, status, next_action_date')
      .eq('subject_entity_id', staff.entity_id)
      .eq('status', 'active')
      .order('next_action_date', { ascending: true })
      .limit(10);

    activeThreads = threads || [];
  }

  // ── Step 4: Current seasonal context ──
  const currentMonth = new Date().getMonth() + 1;
  const { data: seasonal } = await sb
    .from('seasonal_context')
    .select('month, season_name, demand_multiplier, lead_followup_urgency, scheduling_notes, material_notes')
    .eq('month', currentMonth)
    .single();

  const seasonalContext: SeasonalContext = seasonal || {
    month: currentMonth,
    season_name: 'Unknown',
    demand_multiplier: 1.0,
    lead_followup_urgency: 'normal',
    scheduling_notes: null,
    material_notes: null,
  };

  // ── Step 5: Compile context string for LLM ──
  const contextParts: string[] = [];

  contextParts.push(`Staff: ${staff.display_name} (${staff.role})`);
  contextParts.push(`Communication style: ${staff.communication_style}`);
  contextParts.push(`Authority level: L${staff.delegated_authority_level}`);

  if (staff.areas_of_responsibility.length > 0) {
    contextParts.push(`Responsibilities: ${staff.areas_of_responsibility.join(', ')}`);
  }

  contextParts.push(`\nSeason: ${seasonalContext.season_name} (demand x${seasonalContext.demand_multiplier})`);
  contextParts.push(`Lead urgency: ${seasonalContext.lead_followup_urgency}`);
  if (seasonalContext.scheduling_notes) {
    contextParts.push(`Scheduling: ${seasonalContext.scheduling_notes}`);
  }
  if (seasonalContext.material_notes) {
    contextParts.push(`Materials: ${seasonalContext.material_notes}`);
  }

  if (recentObservations.length > 0) {
    contextParts.push('\nRecent observations:');
    for (const obs of recentObservations.slice(0, 5)) {
      contextParts.push(`- [${obs.observation_type}] ${obs.content}`);
    }
  }

  if (activeThreads.length > 0) {
    contextParts.push('\nActive threads:');
    for (const thread of activeThreads.slice(0, 5)) {
      const due = thread.next_action_date
        ? ` (next: ${new Date(thread.next_action_date).toLocaleDateString('en-AU')})`
        : '';
      contextParts.push(`- [${thread.thread_type}] ${thread.context_summary}${due}`);
    }
  }

  return {
    staffProfile: staff,
    recentObservations,
    activeThreads,
    seasonalContext,
    compiledContextString: contextParts.join('\n'),
  };
}

/**
 * Create a new staff profile for first-time interaction.
 */
export async function createStaffProfile(
  telegramUserId: number,
  displayName: string,
): Promise<void> {
  const sb = getSupabase();

  await sb.from('staff_agent_preferences').insert({
    telegram_user_id: telegramUserId,
    display_name: displayName,
    onboarded: false,
  });
}

/**
 * Update a specific staff preference.
 */
export async function updateStaffPreference(
  telegramUserId: number,
  key: string,
  value: unknown,
): Promise<void> {
  const sb = getSupabase();

  await sb
    .from('staff_agent_preferences')
    .update({ [key]: value })
    .eq('telegram_user_id', telegramUserId);
}

/**
 * Handle onboarding conversation for new staff.
 * Returns the response message to send back.
 */
export async function handleOnboarding(
  telegramUserId: number,
  message: string,
): Promise<string> {
  const sb = getSupabase();

  const { data: staff } = await sb
    .from('staff_agent_preferences')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (!staff) {
    return "I don't have a profile for you yet. What's your name?";
  }

  if (!staff.onboarded) {
    // Simple onboarding: mark as onboarded after first response
    await sb
      .from('staff_agent_preferences')
      .update({ onboarded: true })
      .eq('telegram_user_id', telegramUserId);

    return (
      `Welcome to JARVIS, ${staff.display_name}! I'm your AI assistant for SecureWorks WA.\n\n` +
      `Your role: ${staff.role}\n` +
      `Authority level: L${staff.delegated_authority_level}\n` +
      `Quiet hours: ${staff.quiet_hours_start}–${staff.quiet_hours_end}\n\n` +
      `I'll observe group chats, monitor emails, and help track commitments. ` +
      `You can adjust your preferences anytime. Let's get to work!`
    );
  }

  return "You're already set up. How can I help?";
}
