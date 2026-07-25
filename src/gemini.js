const MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent';
const TIMEOUT_MS = 15000;
const ERROR_CODES = {
  MISSING_API_KEY: 'missing_api_key',
  UPSTREAM_401: 'upstream_401',
  UPSTREAM_403: 'upstream_403',
  UPSTREAM_429: 'upstream_429',
  UPSTREAM_5XX: 'upstream_5xx',
  TIMEOUT: 'timeout',
  EMPTY: 'empty_response',
  UNKNOWN: 'unknown'
};

function createGeminiError(code, extra) {
  const err = new Error(code);
  err.code = code;
  if (extra && typeof extra === 'object') Object.assign(err, extra);
  return err;
}

function safeRetryAfter(v) {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Math.ceil(Number(t));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  const d = Date.parse(t);
  if (!Number.isFinite(d)) return null;
  const s = Math.ceil((d - Date.now()) / 1000);
  return Number.isFinite(s) && s >= 0 ? s : null;
}

function extractCandidateText(data) {
  const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = candidate && candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : null;
  if (!parts || parts.length === 0) return '';
  const chunks = [];
  for (const part of parts) {
    if (part && typeof part.text === 'string') chunks.push(part.text);
    else if (part && part.functionCall && part.functionCall.args && typeof part.functionCall.args === 'object') {
      try { chunks.push(JSON.stringify(part.functionCall.args)); } catch (_) {}
    }
    else if (part && typeof part === 'object' && !part.inlineData && ['mode','options','budgetTotal','budgetUsed'].some(function (k) { return Object.prototype.hasOwnProperty.call(part, k); })) {
      try { chunks.push(JSON.stringify(part)); } catch (_) {}
    }
  }
  return chunks.join('').trim();
}

async function fetchGemini(body, apiKey, controller) {
  let response;
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (e) {
    if (e && (e.name === 'AbortError' || controller.signal.aborted)) throw createGeminiError(ERROR_CODES.TIMEOUT);
    throw createGeminiError(ERROR_CODES.UNKNOWN);
  }
  if (!response.ok) {
    if (response.status === 401) throw createGeminiError(ERROR_CODES.UPSTREAM_401);
    if (response.status === 403) throw createGeminiError(ERROR_CODES.UPSTREAM_403);
    if (response.status === 429) throw createGeminiError(ERROR_CODES.UPSTREAM_429, { retryAfter: safeRetryAfter(response.headers.get('retry-after')) });
    if (response.status >= 500) throw createGeminiError(ERROR_CODES.UPSTREAM_5XX);
    throw createGeminiError(ERROR_CODES.UNKNOWN);
  }
  return response;
}

function buildAdvicePrompt(input) {
  return [
    'You are a brief, friendly planning assistant for PocketPlan.',
    'The user is asking for a ' + input.mode + ' plan.',
    'Budget: $' + input.budget,
    'Time available: ' + input.time + ' minutes',
    'Owned items: ' + (input.ownedItems.length ? input.ownedItems.join(', ') : '(none specified)'),
    'Occasion: ' + input.occasion,
    'Constraints: ' + (input.constraints.length ? input.constraints.join(', ') : '(none)'),
    '',
    'Respond in 2-3 short sentences (max 60 words).',
    'Give concrete, friendly advice on what to do.',
    'Do NOT output JSON, markdown, or bullet lists.',
    'Plain text only.'
  ].join('\n');
}

function buildStructuredPlan(input, adviceText) {
  const mode = input.mode;
  const budget = input.budget;
  const time = input.time;
  const ownedItems = Array.isArray(input.ownedItems) ? input.ownedItems : [];
  const constraints = Array.isArray(input.constraints) ? input.constraints : [];
  const occasion = input.occasion || '';

  const budgetUsed = Math.min(budget, Math.max(1, Math.round(budget * 0.7)));

  const defaultMealItems = ['rice', 'eggs', 'vegetables', 'soy sauce'];
  const defaultOutfitItems = ['jeans', 't-shirt', 'jacket', 'sneakers'];
  const defaultItems = mode === 'meal' ? defaultMealItems : defaultOutfitItems;

  const optionItems = ownedItems.length > 0 ? ownedItems.slice(0, 4) : defaultItems.slice(0, 3);

  const safeAdvice = (typeof adviceText === 'string' ? adviceText : '').slice(0, 280);

  const options = [{
    id: mode + '-option-1',
    title: mode === 'meal' ? 'Practical meal using available items' : 'Practical outfit using available items',
    items: optionItems,
    cost: budgetUsed,
    time: time,
    score: 75,
    rationale: safeAdvice || ('Practical ' + mode + ' plan within budget.')
  }];

  const warnings = [];
  if (budget < 10) warnings.push({ level: 'info', message: 'Budget is tight; consider low-cost options.' });
  if (time < 15) warnings.push({ level: 'info', message: 'Limited time available.' });
  constraints.forEach(function (c) {
    warnings.push({ level: 'info', message: 'Constraint: ' + c });
  });

  const missingItems = [];
  if (ownedItems.length === 0) {
    missingItems.push({
      name: mode === 'meal' ? 'basic pantry items' : 'basic wardrobe items',
      reason: 'No owned items listed',
      estimatedCost: Math.min(10, budget)
    });
  }

  const zeroWasteScore = ownedItems.length > 0 ? Math.min(95, 50 + ownedItems.length * 10) : 50;

  const emergencyBanner = {
    active: budget < 5 || time < 5,
    message: budget < 5 ? 'Budget very low' : (time < 5 ? 'Time very limited' : '')
  };

  const publicDecisionTrace = [
    'Plan optimized for ' + mode + ' mode.',
    'Used ' + ownedItems.length + ' owned items.',
    'Budget: $' + budgetUsed + ' of $' + budget + '.',
    'Time: ' + time + ' minutes available.',
    'Backend built deterministic plan from validated input + Gemini advice.'
  ];

  return {
    mode: mode,
    budgetTotal: budget,
    budgetUsed: budgetUsed,
    options: options,
    warnings: warnings,
    missingItems: missingItems,
    zeroWasteScore: zeroWasteScore,
    emergencyBanner: emergencyBanner,
    publicDecisionTrace: publicDecisionTrace,
    occasion: occasion,
    constraints: constraints
  };
}

async function callGemini(input) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw createGeminiError(ERROR_CODES.MISSING_API_KEY);

  const prompt = buildAdvicePrompt(input);
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 200
    }
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);
  let response;
  try {
    response = await fetchGemini(body, apiKey, controller);
  } finally {
    clearTimeout(timeoutId);
  }

  const envelope = await response.json();
  const adviceText = extractCandidateText(envelope);
  if (!adviceText) throw createGeminiError(ERROR_CODES.EMPTY);

  const plan = buildStructuredPlan(input, adviceText);
  return {
    data: plan,
    raw: plan,
    modelVersion: MODEL
  };
}

module.exports = {
  callGemini: callGemini,
  ERROR_CODES: ERROR_CODES,
  _internals: {
    buildStructuredPlan: buildStructuredPlan,
    extractCandidateText: extractCandidateText,
    buildAdvicePrompt: buildAdvicePrompt
  }
};
