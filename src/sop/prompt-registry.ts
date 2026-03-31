// ════════════════════════════════════════════════════════════
// Prompt Registry — Version-controlled prompt rules
//
// Manages rules that get injected into LLM prompts.
// Sources: owner_directive (manual), learned (from patterns),
// sop (from approved SOPs).
// ════════════════════════════════════════════════════════════

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { isEnabled } from '../utils/feature-flags.js';
import { PromptRule } from './types.js';

let _sb: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _sb;
}

/**
 * Load all active prompt rules, optionally filtered by category.
 * Gated by feature flag.
 */
export async function loadActiveRules(category?: string): Promise<PromptRule[]> {
  const enabled = await isEnabled('prompt_rules_enabled');
  if (!enabled) return [];

  const sb = getSupabase();

  let query = sb
    .from('prompt_rules')
    .select('*')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('version', { ascending: false });

  if (category) {
    query = query.eq('category', category);
  }

  const { data } = await query;
  return (data || []) as PromptRule[];
}

/**
 * Propose a new prompt rule. Created as inactive (draft).
 * Must be approved before it takes effect.
 */
export async function proposeRule(
  ruleText: string,
  source: 'owner_directive' | 'learned' | 'sop',
  category: string,
): Promise<string> {
  const sb = getSupabase();

  // Check for existing rules with same category + source
  const { data: existing } = await sb
    .from('prompt_rules')
    .select('id, version')
    .eq('category', category)
    .eq('source', source)
    .eq('active', true)
    .order('version', { ascending: false })
    .limit(1)
    .single();

  const version = existing ? existing.version + 1 : 1;

  const { data, error } = await sb
    .from('prompt_rules')
    .insert({
      rule_text: ruleText,
      category,
      version,
      active: false, // Draft — needs approval
      source,
      previous_version: existing?.id || null,
    })
    .select('id')
    .single();

  if (error) throw error;
  return data.id;
}

/**
 * Approve and activate a prompt rule.
 * Deactivates any previously active rule in the same category+source.
 */
export async function approveRule(ruleId: string): Promise<void> {
  const sb = getSupabase();

  // Get the rule being approved
  const { data: rule } = await sb
    .from('prompt_rules')
    .select('category, source')
    .eq('id', ruleId)
    .single();

  if (!rule) throw new Error(`Rule ${ruleId} not found`);

  // Deactivate previous rules in same category+source
  await sb
    .from('prompt_rules')
    .update({ active: false })
    .eq('category', rule.category)
    .eq('source', rule.source)
    .eq('active', true);

  // Activate the new rule
  await sb
    .from('prompt_rules')
    .update({ active: true })
    .eq('id', ruleId);
}

/**
 * Rollback a rule to a previous version.
 * Deactivates the current version and reactivates the specified one.
 */
export async function rollbackRule(ruleId: string, targetVersion: number): Promise<void> {
  const sb = getSupabase();

  // Get the current rule's category and source
  const { data: current } = await sb
    .from('prompt_rules')
    .select('category, source')
    .eq('id', ruleId)
    .single();

  if (!current) throw new Error(`Rule ${ruleId} not found`);

  // Deactivate all versions of this category+source
  await sb
    .from('prompt_rules')
    .update({ active: false })
    .eq('category', current.category)
    .eq('source', current.source);

  // Activate the target version
  const { error } = await sb
    .from('prompt_rules')
    .update({ active: true })
    .eq('category', current.category)
    .eq('source', current.source)
    .eq('version', targetVersion);

  if (error) throw error;
}

/**
 * Get version history for a category+source.
 */
export async function getRuleHistory(
  category: string,
  source?: string,
): Promise<PromptRule[]> {
  const sb = getSupabase();

  let query = sb
    .from('prompt_rules')
    .select('*')
    .eq('category', category)
    .order('version', { ascending: false });

  if (source) {
    query = query.eq('source', source);
  }

  const { data } = await query;
  return (data || []) as PromptRule[];
}

/**
 * Compile all active rules into a prompt-injectable string.
 * Grouped by category with headers.
 */
export async function compileRulesForPrompt(categories?: string[]): Promise<string> {
  const enabled = await isEnabled('prompt_rules_enabled');
  if (!enabled) return '';

  const rules = categories
    ? (await Promise.all(categories.map((c) => loadActiveRules(c)))).flat()
    : await loadActiveRules();

  if (rules.length === 0) return '';

  // Group by category
  const grouped = new Map<string, string[]>();
  for (const rule of rules) {
    const cat = rule.category;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(rule.rule_text);
  }

  // Build prompt string
  const parts: string[] = ['## Business Rules'];
  for (const [category, ruleTexts] of grouped) {
    parts.push(`\n### ${category}`);
    for (const text of ruleTexts) {
      parts.push(`- ${text}`);
    }
  }

  return parts.join('\n');
}
