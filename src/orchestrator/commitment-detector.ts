// ════════════════════════════════════════════════════════════
// Commitment Detector
//
// Regex-based detection for commitments in outbound messages:
// - Price/cost commitments ($X, "quote", "price", "cost")
// - Date commitments ("start on", "complete by", "deliver by", "ready by")
// - Warranty/guarantee promises
// - Scope promises ("we will", "we'll include", "scope includes")
//
// Runs on ALL outbound messages.
// ════════════════════════════════════════════════════════════

export interface CommitmentResult {
  detected: boolean;
  type?: 'price' | 'date' | 'warranty' | 'scope';
  confidence: number;
  matched_text?: string;
}

interface PatternDef {
  type: CommitmentResult['type'];
  patterns: RegExp[];
  confidence: number;
}

const COMMITMENT_PATTERNS: PatternDef[] = [
  {
    type: 'price',
    patterns: [
      /\$\s?\d[\d,]*(?:\.\d{2})?/i,
      /\b(?:quote|price|cost|total|amount)\b.*?\$\s?\d/i,
      /\b(?:we(?:'ll| will) (?:do it|charge|price it|quote(?: it)?))\b.*?\$?\d/i,
      /\bfor\s+\$\s?\d[\d,]*/i,
      /\b(?:price|cost|total)\s+(?:is|of|at)\b/i,
    ],
    confidence: 0.90,
  },
  {
    type: 'date',
    patterns: [
      /\b(?:start|begin|commence)\s+(?:on|by|from)\s+/i,
      /\b(?:complete|finish|done|ready|deliver)\s+(?:by|before|on)\s+/i,
      /\b(?:install(?:ation)?)\s+(?:date|on|by|from|scheduled)\b/i,
      /\b(?:we(?:'ll| will) (?:have it|get it|be there|start|finish))\b.*?\b(?:by|on|before)\b/i,
      /\b(?:eta|timeline|timeframe)\s*(?:is|of|:)\s*/i,
      /\b(?:(?:next|this)\s+(?:week|monday|tuesday|wednesday|thursday|friday))\b/i,
    ],
    confidence: 0.85,
  },
  {
    type: 'warranty',
    patterns: [
      /\b(?:warrant(?:y|ied)|guarantee(?:d)?)\b/i,
      /\b\d+\s*(?:year|yr|month)\s*(?:warrant|guarantee)\b/i,
      /\b(?:covered|coverage)\s+(?:for|under)\b/i,
      /\b(?:we(?:'ll| will)\s+(?:cover|replace|fix|repair))\b.*\b(?:free|no charge|at our cost)\b/i,
    ],
    confidence: 0.90,
  },
  {
    type: 'scope',
    patterns: [
      /\b(?:we(?:'ll| will)\s+(?:include|provide|supply|install|do|handle|take care of))\b/i,
      /\b(?:scope\s+includes|included in (?:the\s+)?(?:quote|price|scope))\b/i,
      /\b(?:that(?:'s| is)\s+included)\b/i,
      /\b(?:no (?:extra|additional) (?:charge|cost))\b/i,
      /\b(?:we(?:'ll| will)\s+(?:also|additionally))\b/i,
      /\b(?:comes with|inclusive of)\b/i,
    ],
    confidence: 0.80,
  },
];

/**
 * Detect commitments in a message.
 * Returns the highest-confidence match, or { detected: false } if none.
 */
export function detectCommitment(message: string): CommitmentResult {
  if (!message || message.trim().length < 5) {
    return { detected: false, confidence: 0 };
  }

  let bestMatch: CommitmentResult = { detected: false, confidence: 0 };

  for (const def of COMMITMENT_PATTERNS) {
    for (const pattern of def.patterns) {
      const match = message.match(pattern);
      if (match && def.confidence > bestMatch.confidence) {
        bestMatch = {
          detected: true,
          type: def.type,
          confidence: def.confidence,
          matched_text: match[0],
        };
      }
    }
  }

  return bestMatch;
}
