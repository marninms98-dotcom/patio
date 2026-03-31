// ════════════════════════════════════════════════════════════
// Commitment Detector V2 — Haiku classifier + regex A/B testing
//
// Runs V1 regex and V2 Haiku in parallel, compares results,
// logs discrepancies for monitoring which classifier is better.
// ════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { detectCommitment as commitmentDetectorV1 } from './commitment-detector.js';
import { isEnabled } from '../utils/feature-flags.js';

let _sb: SupabaseClient | null = null;
let _anthropic: Anthropic | null = null;

function getSupabase(): SupabaseClient {
  if (!_sb) {
    _sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
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

export interface CommitmentItem {
  type: 'price' | 'timeline' | 'scope' | 'warranty' | 'material_spec';
  value: string;
  confidence?: number;
  context?: string;
}

export interface CommitmentDetectionV2Result {
  messageId: string;
  messageText: string;
  channel: string;
  entityId?: string;
  regexDetected: boolean;
  regexCommitments: CommitmentItem[];
  regexConfidence: number;
  haikuDetected: boolean;
  haikuCommitments: CommitmentItem[];
  haikuConfidence: number;
  haikuReasoning: string;
  haikuTokensUsed: number;
  agreement: boolean;
  discrepancyType?: string;
  disagreementSeverity?: string;
  classifierUsed: 'regex' | 'haiku';
}

/**
 * Run V1 regex and V2 Haiku in parallel, compare, log results.
 */
export async function detectCommitments(
  messageText: string,
  messageId: string,
  channel: string,
  entityId?: string,
): Promise<CommitmentDetectionV2Result> {
  // Check feature flag — determines which classifier result is used downstream
  const v2Enabled = await isEnabled('commitment_v2_enabled');

  // Run both detectors in parallel (always, for A/B comparison)
  const [v1Result, v2Result] = await Promise.all([
    runV1Detection(messageText),
    detectCommitmentsHaiku(messageText),
  ]);

  // Compare results
  const agreement = v1Result.detected === v2Result.detected;
  const discrepancy = !agreement ? analyzeDiscrepancy(v1Result, v2Result) : undefined;

  const result: CommitmentDetectionV2Result = {
    messageId,
    messageText,
    channel,
    entityId,
    regexDetected: v1Result.detected,
    regexCommitments: v1Result.commitments,
    regexConfidence: v1Result.confidence,
    haikuDetected: v2Result.detected,
    haikuCommitments: v2Result.commitments,
    haikuConfidence: v2Result.confidence,
    haikuReasoning: v2Result.reasoning,
    haikuTokensUsed: v2Result.tokensUsed,
    agreement,
    discrepancyType: discrepancy?.type,
    disagreementSeverity: discrepancy?.severity,
    classifierUsed: v2Enabled ? 'haiku' : 'regex',
  };

  // Log to DB
  await logDetectionResult(result);

  // Warn on high-severity disagreements
  if (discrepancy?.severity === 'high') {
    console.warn(`[commitment-v2] HIGH disagreement on ${messageId}: regex=${v1Result.detected} haiku=${v2Result.detected} type=${discrepancy.type}`);
  }

  return result;
}

/**
 * Run V1 regex detector and normalize output.
 */
function runV1Detection(messageText: string): { detected: boolean; commitments: CommitmentItem[]; confidence: number } {
  const v1 = commitmentDetectorV1(messageText);

  const commitments: CommitmentItem[] = [];
  if (v1.detected && v1.type) {
    commitments.push({
      type: mapV1Type(v1.type),
      value: v1.matched_text || messageText.slice(0, 100),
      confidence: v1.confidence,
    });
  }

  return {
    detected: v1.detected,
    commitments,
    confidence: v1.confidence,
  };
}

/**
 * Map V1 type strings to V2 CommitmentItem types.
 */
function mapV1Type(v1Type: string): CommitmentItem['type'] {
  switch (v1Type) {
    case 'price': return 'price';
    case 'date': return 'timeline';
    case 'warranty': return 'warranty';
    case 'scope': return 'scope';
    default: return 'scope';
  }
}

/**
 * Run Haiku commitment detection.
 */
async function detectCommitmentsHaiku(messageText: string): Promise<{
  detected: boolean;
  commitments: CommitmentItem[];
  confidence: number;
  reasoning: string;
  tokensUsed: number;
}> {
  try {
    const anthropic = getAnthropic();
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: 'You analyze messages for business commitments in an Australian outdoor construction context (patios, fencing, carports in Perth WA). Detect commitments regarding: price, timeline, scope, warranty, material specifications. Output JSON: {"commitment": boolean, "items": [{"type": "price"|"timeline"|"scope"|"warranty"|"material_spec", "value": "string", "confidence": 0.0-1.0}], "reasoning": "string"}',
      messages: [{ role: 'user', content: messageText }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const parsed = JSON.parse(text);

    const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

    return {
      detected: parsed.commitment === true,
      commitments: (parsed.items || []).map((item: any) => ({
        type: item.type || 'scope',
        value: item.value || '',
        confidence: item.confidence || 0.5,
      })),
      confidence: parsed.items?.length > 0
        ? parsed.items.reduce((sum: number, i: any) => sum + (i.confidence || 0.5), 0) / parsed.items.length
        : 0,
      reasoning: parsed.reasoning || '',
      tokensUsed,
    };
  } catch (err) {
    console.error('[commitment-v2] Haiku detection failed:', err);
    return { detected: false, commitments: [], confidence: 0, reasoning: 'API error', tokensUsed: 0 };
  }
}

/**
 * Analyze discrepancy between V1 and V2 results.
 */
function analyzeDiscrepancy(
  v1: { detected: boolean; commitments: CommitmentItem[]; confidence: number },
  v2: { detected: boolean; commitments: CommitmentItem[]; confidence: number },
): { type: string; severity: string } {
  if (v1.detected && !v2.detected) {
    return { type: 'false_positive_regex', severity: 'low' };
  }

  if (!v1.detected && v2.detected) {
    // Haiku found something regex missed — check if it's price/timeline (high severity)
    const hasCritical = v2.commitments.some((c) => c.type === 'price' || c.type === 'timeline');
    return {
      type: 'false_negative_regex',
      severity: hasCritical ? 'high' : 'medium',
    };
  }

  // Both detected but different types
  return { type: 'different_types', severity: 'low' };
}

/**
 * Log full A/B detection result to commitment_detection_results table.
 */
async function logDetectionResult(result: CommitmentDetectionV2Result): Promise<void> {
  const sb = getSupabase();

  await sb.from('commitment_detection_results').upsert({
    message_id: result.messageId,
    channel: result.channel,
    entity_id: result.entityId || null,
    message_text: result.messageText.slice(0, 2000),
    message_timestamp: new Date().toISOString(),
    regex_detected: result.regexDetected,
    regex_commitments: result.regexCommitments,
    regex_confidence: result.regexConfidence,
    haiku_detected: result.haikuDetected,
    haiku_commitments: result.haikuCommitments,
    haiku_confidence: result.haikuConfidence,
    haiku_reasoning: result.haikuReasoning,
    haiku_tokens_used: result.haikuTokensUsed,
    agreement: result.agreement,
    discrepancy_type: result.discrepancyType || null,
    classifier_used: result.classifierUsed,
    disagreement_severity: result.disagreementSeverity || null,
  }, { onConflict: 'message_id' });
}

/**
 * Get A/B comparison statistics.
 */
export async function getDisagreementStats(since?: Date): Promise<{
  total: number;
  agreements: number;
  disagreements: number;
  falsePositiveRegex: number;
  falseNegativeRegex: number;
}> {
  const sb = getSupabase();

  let query = sb.from('commitment_detection_results').select('agreement, discrepancy_type');
  if (since) query = query.gte('created_at', since.toISOString());

  const { data } = await query;
  if (!data) return { total: 0, agreements: 0, disagreements: 0, falsePositiveRegex: 0, falseNegativeRegex: 0 };

  return {
    total: data.length,
    agreements: data.filter((r) => r.agreement).length,
    disagreements: data.filter((r) => !r.agreement).length,
    falsePositiveRegex: data.filter((r) => r.discrepancy_type === 'false_positive_regex').length,
    falseNegativeRegex: data.filter((r) => r.discrepancy_type === 'false_negative_regex').length,
  };
}
