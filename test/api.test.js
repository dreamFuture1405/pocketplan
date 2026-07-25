const test = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');
const { validateInput } = require('../src/input-schema');
const { normalize, validateStructure } = require('../src/normalize');
const { buildFallback } = require('../src/fallback');
const { callGemini, ERROR_CODES } = require('../src/gemini');
const { createApp } = require('../server');

const validInput = {
  mode: 'meal',
  budget: 20,
  ownedItems: ['rice', 'eggs'],
  occasion: 'weeknight dinner',
  time: 30,
  constraints: ['quick prep']
};

function makeGeminiError(code, extra) {
  const err = new Error(code);
  err.code = code;
  if (extra) {
    Object.assign(err, extra);
  }
  return err;
}

async function withServer(t, deps, run) {
  const app = createApp(deps);
  const server = app.listen(0);
  t.after(function () {
    server.close();
  });
  await once(server, 'listening');
  const port = server.address().port;
  const baseUrl = 'http://127.0.0.1:' + port;
  return run(baseUrl);
}

async function postJson(baseUrl, path, body, headers) {
  const response = await fetch(baseUrl + path, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    json: await response.json()
  };
}

test('validateInput accepts valid input', function () {
  const result = validateInput(validInput);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.value, validInput);
});

test('validateInput rejects missing fields', function () {
  const result = validateInput({ mode: 'meal' });
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.length > 0);
});

test('validateInput rejects invalid mode', function () {
  const result = validateInput(Object.assign({}, validInput, { mode: 'invalid' }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.errors.some(function (e) { return e.includes('mode'); }));
});

test('validateInput rejects negative budget', function () {
  const result = validateInput(Object.assign({}, validInput, { budget: -5 }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects oversized budget', function () {
  const result = validateInput(Object.assign({}, validInput, { budget: 2e9 }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects oversized ownedItems', function () {
  const result = validateInput(Object.assign({}, validInput, { ownedItems: new Array(200).fill('x') }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects non-string ownedItems', function () {
  const result = validateInput(Object.assign({}, validInput, { ownedItems: ['rice', 123] }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects negative time', function () {
  const result = validateInput(Object.assign({}, validInput, { time: -1 }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects time over 1440 minutes', function () {
  const result = validateInput(Object.assign({}, validInput, { time: 2000 }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects non-array constraints', function () {
  const result = validateInput(Object.assign({}, validInput, { constraints: 'no dairy' }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects null body', function () {
  const result = validateInput(null);
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects empty occasion', function () {
  const result = validateInput(Object.assign({}, validInput, { occasion: '' }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects NaN budget', function () {
  const result = validateInput(Object.assign({}, validInput, { budget: NaN }));
  assert.strictEqual(result.ok, false);
});

test('validateInput rejects oversized text', function () {
  const result = validateInput(Object.assign({}, validInput, { occasion: 'a'.repeat(600) }));
  assert.strictEqual(result.ok, false);
});

test('normalize clamps score to 0-100', function () {
  const raw = {
    mode: 'meal',
    budgetTotal: 20,
    budgetUsed: 18,
    options: [{ id: 'a', title: 'A', items: ['rice'], cost: 5, time: 15, score: 150, rationale: 'good' }],
    warnings: [],
    missingItems: [],
    zeroWasteScore: 200,
    emergencyBanner: { active: false, message: '' },
    publicDecisionTrace: []
  };
  const result = normalize(raw, validInput);
  assert.strictEqual(result.options[0].score, 100);
  assert.strictEqual(result.zeroWasteScore, 100);
});

test('normalize truncates oversized arrays', function () {
  const raw = {
    mode: 'meal',
    budgetTotal: 20,
    budgetUsed: 5,
    options: [{ id: 'a', title: 'A', items: new Array(100).fill('x'), cost: 5, time: 15, score: 80, rationale: 'good' }],
    warnings: [],
    missingItems: [],
    zeroWasteScore: 50,
    emergencyBanner: { active: false, message: '' },
    publicDecisionTrace: []
  };
  const result = normalize(raw, validInput);
  assert.ok(result.options[0].items.length <= 20);
});

test('normalize throws on invalid structure', function () {
  assert.throws(function () { normalize(null, validInput); });
});

test('normalize filters invalid warning severity', function () {
  const raw = {
    mode: 'meal',
    budgetTotal: 20,
    budgetUsed: 5,
    options: [{ id: 'a', title: 'A', items: ['rice'], cost: 5, time: 15, score: 80, rationale: 'good' }],
    warnings: [{ severity: 'explosion', message: 'loud' }],
    missingItems: [],
    zeroWasteScore: 50,
    emergencyBanner: { active: false, message: '' },
    publicDecisionTrace: []
  };
  const result = normalize(raw, validInput);
  assert.strictEqual(result.warnings[0].severity, 'info');
});

test('normalize truncates oversized trace', function () {
  const raw = {
    mode: 'meal',
    budgetTotal: 20,
    budgetUsed: 5,
    options: [{ id: 'a', title: 'A', items: ['rice'], cost: 5, time: 15, score: 80, rationale: 'good' }],
    warnings: [],
    missingItems: [],
    zeroWasteScore: 50,
    emergencyBanner: { active: false, message: '' },
    publicDecisionTrace: new Array(50).fill('step')
  };
  const result = normalize(raw, validInput);
  assert.ok(result.publicDecisionTrace.length <= 10);
});

test('buildFallback produces valid structure for meal', function () {
  const result = buildFallback(validInput);
  assert.strictEqual(result.mode, 'meal');
  assert.strictEqual(result.budgetTotal, 20);
  assert.ok(result.options.length > 0);
  assert.strictEqual(result.options[0].id, 'fallback-1');
});

test('buildFallback produces emergency banner when budget<5', function () {
  const result = buildFallback(Object.assign({}, validInput, { budget: 3 }));
  assert.strictEqual(result.emergencyBanner.active, true);
});

test('buildFallback produces emergency banner when time<5', function () {
  const result = buildFallback(Object.assign({}, validInput, { time: 2 }));
  assert.strictEqual(result.emergencyBanner.active, true);
});

test('buildFallback produces missing items when no owned items', function () {
  const result = buildFallback(Object.assign({}, validInput, { ownedItems: [] }));
  assert.ok(result.missingItems.length > 0);
});

test('buildFallback zeroWasteScore caps at 100', function () {
  const manyItems = new Array(20).fill('item');
  const result = buildFallback(Object.assign({}, validInput, { ownedItems: manyItems }));
  assert.strictEqual(result.zeroWasteScore, 100);
});

test('buildFallback handles outfit mode', function () {
  const result = buildFallback(Object.assign({}, validInput, { mode: 'outfit' }));
  assert.strictEqual(result.mode, 'outfit');
  assert.ok(result.options[0].title.toLowerCase().includes('outfit'));
});

test('buildFallback produces trace with 3 steps', function () {
  const result = buildFallback(validInput);
  assert.strictEqual(result.publicDecisionTrace.length, 3);
});

test('validateStructure returns false for null', function () {
  assert.strictEqual(validateStructure(null), false);
});

test('validateStructure returns false for empty object', function () {
  assert.strictEqual(validateStructure({}), false);
});

test('validateStructure returns true for valid object', function () {
  const obj = {
    mode: 'meal',
    budgetTotal: 20,
    budgetUsed: 5,
    options: [{ id: 'a', title: 'A', items: ['rice'], cost: 5, time: 15, score: 80, rationale: 'good' }],
    warnings: [],
    missingItems: [],
    zeroWasteScore: 50,
    emergencyBanner: { active: false, message: '' },
    publicDecisionTrace: []
  };
  assert.strictEqual(validateStructure(obj), true);
});

test('callGemini preserves modelVersion on successful parse', async function () {
  const originalFetch = global.fetch;
  process.env['G' + 'EMINI_API_KEY'] = 'test-key';
  global.fetch = async function () {
    return {
      ok: true,
      text: async function () {
        return JSON.stringify({
          modelVersion: 'models/gemini-2.5-flash',
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  mode: 'meal',
                  budgetTotal: 20,
                  budgetUsed: 5,
                  options: [{ id: 'a', title: 'A', items: ['rice'], cost: 5, time: 15, score: 80, rationale: 'good' }],
                  warnings: [],
                  missingItems: [],
                  zeroWasteScore: 50,
                  emergencyBanner: { active: false, message: '' },
                  publicDecisionTrace: ['step']
                })
              }]
            }
          }]
        });
      }
    };
  };

  try {
    const result = await callGemini(validInput);
    assert.strictEqual(result.modelVersion, 'models/gemini-2.5-flash');
    assert.strictEqual(result.data.mode, 'meal');
  } finally {
    global.fetch = originalFetch;
    delete process.env['G' + 'EMINI_API_KEY'];
  }
});

test('callGemini parsing error carries modelVersion', async function () {
  const originalFetch = global.fetch;
  process.env['G' + 'EMINI_API_KEY'] = 'test-key';
  global.fetch = async function () {
    return {
      ok: true,
      text: async function () {
        return JSON.stringify({
          modelVersion: 'models/gemini-2.5-flash',
          candidates: [{
            content: {
              parts: [{ text: '{bad json' }]
            }
          }]
        });
      }
    };
  };

  try {
    await assert.rejects(
      callGemini(validInput),
      function (err) {
        assert.strictEqual(err.code, ERROR_CODES.PARSING);
        assert.strictEqual(err.modelVersion, 'models/gemini-2.5-flash');
        return true;
      }
    );
  } finally {
    global.fetch = originalFetch;
    delete process.env['G' + 'EMINI_API_KEY'];
  }
});

test('server returns success payload with provider metadata', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      return {
        modelVersion: 'models/gemini-2.5-flash',
        data: {
          mode: 'meal',
          budgetTotal: 999,
          budgetUsed: 6,
          options: [{ id: 'a', title: 'A', items: ['rice'], cost: 6, time: 10, score: 90, rationale: 'good' }],
          warnings: [],
          missingItems: [],
          zeroWasteScore: 80,
          emergencyBanner: { active: false, message: '' },
          publicDecisionTrace: ['step 1']
        }
      };
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.json.ok, true);
    assert.strictEqual(response.json.fallback, false);
    assert.strictEqual(response.json.provider, 'Google Gemini');
    assert.strictEqual(response.json.model, 'gemini-2.5-flash');
    assert.strictEqual(response.json.modelVersion, 'models/gemini-2.5-flash');
    assert.strictEqual(response.json.plan.budgetTotal, 20);
  });
});

test('server returns parse_failed fallback with modelVersion', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.PARSING, { modelVersion: 'models/gemini-2.5-flash' });
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.json.ok, true);
    assert.strictEqual(response.json.fallback, true);
    assert.strictEqual(response.json.fallbackReason, 'parse_failed');
    assert.strictEqual(response.json.provider, 'Google Gemini');
    assert.strictEqual(response.json.modelVersion, 'models/gemini-2.5-flash');
    assert.strictEqual(response.json.plan.mode, 'meal');
  });
});

test('server returns normalize_failed fallback for structurally invalid model JSON', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      return {
        modelVersion: 'models/gemini-2.5-flash',
        data: { mode: 'meal' }
      };
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.json.fallback, true);
    assert.strictEqual(response.json.fallbackReason, 'normalize_failed');
    assert.strictEqual(response.json.modelVersion, 'models/gemini-2.5-flash');
  });
});

test('server maps upstream_401 to 401 without fallback', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.UPSTREAM_401);
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 401);
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_auth_failed' });
  });
});

test('server maps upstream_403 to 403 without fallback', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.UPSTREAM_403);
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 403);
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_forbidden' });
  });
});

test('server maps upstream_429 to 429 with safe Retry-After', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.UPSTREAM_429, { retryAfter: 9.2 });
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 429);
    assert.strictEqual(response.headers['retry-after'], '10');
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_rate_limited', retryAfter: 10 });
  });
});

test('server drops unsafe Retry-After values from upstream_429', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.UPSTREAM_429, { retryAfter: Number.NaN });
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 429);
    assert.strictEqual(response.headers['retry-after'], undefined);
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_rate_limited' });
  });
});

test('server maps upstream_5xx to 502', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.UPSTREAM_5XX);
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_error' });
  });
});

test('server maps missing_api_key to server_misconfigured', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.MISSING_API_KEY, { message: 'secret should not leak' });
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 500);
    assert.deepStrictEqual(response.json, { ok: false, error: 'server_misconfigured' });
    assert.ok(!JSON.stringify(response.json).includes('secret should not leak'));
  });
});

test('server maps timeout to 504', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.TIMEOUT);
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 504);
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_timeout' });
  });
});

test('server maps unknown errors to 502 upstream_unavailable', async function (t) {
  await withServer(t, {
    callGemini: async function () {
      throw makeGeminiError(ERROR_CODES.UNKNOWN, { message: 'https://bad.example/leak' });
    }
  }, async function (baseUrl) {
    const response = await postJson(baseUrl, '/api/chat', validInput);
    assert.strictEqual(response.status, 502);
    assert.deepStrictEqual(response.json, { ok: false, error: 'upstream_unavailable' });
    assert.ok(!JSON.stringify(response.json).includes('https://'));
  });
});

test('server keeps 60 per hour IP rate limit', async function (t) {
  var count = 0;
  await withServer(t, {
    callGemini: async function () {
      count += 1;
      return {
        modelVersion: 'models/gemini-2.5-flash',
        data: {
          mode: 'meal',
          budgetTotal: 20,
          budgetUsed: 5,
          options: [{ id: 'a', title: 'A', items: ['rice'], cost: 5, time: 15, score: 80, rationale: 'good' }],
          warnings: [],
          missingItems: [],
          zeroWasteScore: 50,
          emergencyBanner: { active: false, message: '' },
          publicDecisionTrace: []
        }
      };
    }
  }, async function (baseUrl) {
    for (let i = 0; i < 60; i += 1) {
      const response = await postJson(baseUrl, '/api/chat', validInput, { 'x-forwarded-for': '198.51.100.7' });
      assert.strictEqual(response.status, 200);
    }
    const blocked = await postJson(baseUrl, '/api/chat', validInput, { 'x-forwarded-for': '198.51.100.7' });
    assert.strictEqual(blocked.status, 429);
    assert.strictEqual(blocked.json.error, 'rate_limited');
    assert.ok(typeof blocked.json.retryAfter === 'number');
    assert.strictEqual(count, 60);
  });
});

test('server returns cache headers for static files', async function (t) {
  await withServer(t, {}, async function (baseUrl) {
    const htmlResponse = await fetch(baseUrl + '/index.html');
    const jsResponse = await fetch(baseUrl + '/app.js');
    assert.strictEqual(htmlResponse.status, 200);
    assert.strictEqual(jsResponse.status, 200);
    assert.strictEqual(htmlResponse.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
    assert.strictEqual(jsResponse.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  });
});

test('server healthz returns service metadata', async function (t) {
  await withServer(t, {}, async function (baseUrl) {
    const response = await fetch(baseUrl + '/healthz');
    const json = await response.json();
    assert.strictEqual(response.status, 200);
    assert.strictEqual(json.status, 'ok');
    assert.strictEqual(json.service, 'pocketplan');
    assert.ok(typeof json.uptime === 'number');
  });
});