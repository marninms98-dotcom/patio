// ════════════════════════════════════════════════════════════
// Intention Validator — JSON schema validation using ajv
// ════════════════════════════════════════════════════════════

import Ajv from 'ajv';

const ajv = new Ajv({ allErrors: true });

// JSON Schema for Intention objects
const intentionSchema = {
  type: 'object',
  required: ['channel', 'raw_input'],
  properties: {
    channel: {
      type: 'string',
      enum: ['telegram', 'web', 'api', 'system', 'cron'],
    },
    raw_input: {
      type: 'string',
      minLength: 1,
      maxLength: 10000,
    },
    user_id: {
      type: 'string',
      format: 'uuid',
      nullable: true,
    },
    org_id: {
      type: 'string',
      format: 'uuid',
    },
    detected_intent: {
      type: 'string',
      minLength: 1,
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1,
    },
    parsed_params: {
      type: 'object',
    },
    entity_type: {
      type: 'string',
      nullable: true,
    },
    entity_id: {
      type: 'string',
      format: 'uuid',
      nullable: true,
    },
    chain_step: {
      type: 'integer',
      minimum: 0,
    },
    context: {
      type: 'object',
    },
  },
  additionalProperties: false,
};

// Add UUID format validation
ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const validate = ajv.compile(intentionSchema);

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Validate an intention object against the JSON schema.
 */
export function validateIntention(intention: unknown): ValidationResult {
  const valid = validate(intention);

  if (valid) {
    return { valid: true };
  }

  const errors = (validate.errors || []).map((err) => {
    const path = err.instancePath || '/';
    return `${path}: ${err.message}`;
  });

  return { valid: false, errors };
}
