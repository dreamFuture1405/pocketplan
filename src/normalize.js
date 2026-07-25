const { outputSchema } = require('./output-schema');

function validateStructure(obj) {
  if (!obj || typeof obj !== 'object') return false;
  for (const key of outputSchema.required) {
    if (!(key in obj)) return false;
  }
  if (!['meal', 'outfit'].includes(obj.mode)) return false;
  if (!Array.isArray(obj.options) || obj.options.length === 0) return false;
  if (typeof obj.zeroWasteScore !== 'number') return false;
  if (!obj.emergencyBanner || typeof obj.emergencyBanner.active !== 'boolean') return false;
  return true;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalize(raw, input) {
  if (!validateStructure(raw)) {
    throw new Error('invalid model output structure');
  }

  const result = {
    mode: raw.mode,
    budgetTotal: input.budget,
    budgetUsed: clamp(Number(raw.budgetUsed) || 0, 0, input.budget * 3),
    options: raw.options.slice(0, 5).map(function (opt) {
      return {
        id: String(opt.id || 'opt'),
        title: String(opt.title || 'Option').slice(0, 100),
        items: Array.isArray(opt.items) ? opt.items.slice(0, 20).map(function (s) { return String(s).slice(0, 100); }) : [],
        cost: clamp(Number(opt.cost) || 0, 0, input.budget * 3),
        time: clamp(Number(opt.time) || 0, 0, 1440),
        score: clamp(Number(opt.score) || 0, 0, 100),
        rationale: String(opt.rationale || '').slice(0, 500)
      };
    }),
    warnings: (Array.isArray(raw.warnings) ? raw.warnings : []).slice(0, 10).map(function (w) {
      return {
        severity: ['info', 'warn', 'critical'].includes(w.severity) ? w.severity : 'info',
        message: String(w.message || '').slice(0, 200)
      };
    }),
    missingItems: (Array.isArray(raw.missingItems) ? raw.missingItems : []).slice(0, 20).map(function (m) {
      return {
        name: String(m.name || 'item').slice(0, 100),
        reason: String(m.reason || '').slice(0, 200),
        estimatedCost: clamp(Number(m.estimatedCost) || 0, 0, 1000000)
      };
    }),
    zeroWasteScore: clamp(Number(raw.zeroWasteScore) || 0, 0, 100),
    emergencyBanner: {
      active: Boolean(raw.emergencyBanner.active),
      message: String(raw.emergencyBanner.message || '').slice(0, 200)
    },
    publicDecisionTrace: (Array.isArray(raw.publicDecisionTrace) ? raw.publicDecisionTrace : [])
      .slice(0, 10)
      .map(function (s) { return String(s).slice(0, 200); })
  };

  return result;
}

module.exports = { normalize, validateStructure };