function buildFallback(input) {
  const mode = input.mode;
  const budget = input.budget;
  const ownedItems = input.ownedItems;
  const time = input.time;
  const constraints = input.constraints;

  const itemCount = ownedItems.length;
  const zeroWasteScore = Math.min(100, itemCount * 25);

  const emergencyBanner = {
    active: budget < 5 || time < 5,
    message: budget < 5 || time < 5
      ? 'Budget or time is critically low. Plan applies minimum defaults.'
      : ''
  };

  const warnings = [];
  if (constraints.length > 5) {
    warnings.push({ severity: 'warn', message: 'Many constraints; expect conservative options.' });
  }
  if (time < 15) {
    warnings.push({ severity: 'warn', message: 'Very short time; options will be minimal.' });
  }

  const options = [{
    id: 'fallback-1',
    title: mode === 'meal' ? 'Simple pantry meal' : 'Simple outfit from owned items',
    items: ownedItems.slice(0, 5),
    cost: Math.min(budget, Math.max(0, budget * 0.5)),
    time: Math.min(time, 15),
    score: zeroWasteScore,
    rationale: 'Fallback plan using owned items. AI model unavailable or returned malformed output.'
  }];

  const missingItems = ownedItems.length === 0 ? [{
    name: mode === 'meal' ? 'basic ingredients' : 'basic wardrobe items',
    reason: 'No owned items listed',
    estimatedCost: Math.min(budget, 10)
  }] : [];

  return {
    mode: mode,
    budgetTotal: budget,
    budgetUsed: options[0].cost,
    options: options,
    warnings: warnings,
    missingItems: missingItems,
    zeroWasteScore: zeroWasteScore,
    emergencyBanner: emergencyBanner,
    publicDecisionTrace: [
      'AI model unavailable; fallback plan generated.',
      'Used ' + ownedItems.length + ' owned items.',
      'Plan fits ' + mode + ' mode within budget ' + budget + '.'
    ]
  };
}

module.exports = { buildFallback };