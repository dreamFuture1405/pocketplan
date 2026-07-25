const outputSchema = {
  type: 'object',
  required: ['mode', 'budgetTotal', 'budgetUsed', 'options', 'warnings', 'missingItems', 'zeroWasteScore', 'emergencyBanner', 'publicDecisionTrace'],
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['meal', 'outfit'] },
    budgetTotal: { type: 'number', minimum: 0 },
    budgetUsed: { type: 'number', minimum: 0 },
    options: {
      type: 'array',
      minItems: 1,
      maxItems: 5,
      items: {
        type: 'object',
        required: ['id', 'title', 'items', 'cost', 'time', 'score', 'rationale'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string', maxLength: 100 },
          items: { type: 'array', items: { type: 'string', maxLength: 100 } },
          cost: { type: 'number', minimum: 0 },
          time: { type: 'number', minimum: 0 },
          score: { type: 'number', minimum: 0, maximum: 100 },
          rationale: { type: 'string', maxLength: 500 }
        }
      }
    },
    warnings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'message'],
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: ['info', 'warn', 'critical'] },
          message: { type: 'string', maxLength: 200 }
        }
      }
    },
    missingItems: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'reason', 'estimatedCost'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', maxLength: 100 },
          reason: { type: 'string', maxLength: 200 },
          estimatedCost: { type: 'number', minimum: 0 }
        }
      }
    },
    zeroWasteScore: { type: 'number', minimum: 0, maximum: 100 },
    emergencyBanner: {
      type: 'object',
      required: ['active', 'message'],
      additionalProperties: false,
      properties: {
        active: { type: 'boolean' },
        message: { type: 'string', maxLength: 200 }
      }
    },
    publicDecisionTrace: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string', maxLength: 200 }
    }
  }
};

module.exports = { outputSchema };