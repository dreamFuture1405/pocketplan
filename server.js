const express = require('express');
const path = require('path');

const PORT = process.env.PORT || 8080;
const PROVIDER = 'Google Gemini';
const MODEL = 'gemini-2.5-flash';
const JSON_LIMIT = '256kb';
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const DIAGNOSTIC_MODULE_PATHS = [
  './src/input-schema',
  './src/gemini',
  './src/normalize',
  './src/fallback'
];

function boundedString(value, maxLen) {
  const str = value === null || value === undefined ? '' : String(value);
  return str.length <= maxLen ? str : str.slice(0, maxLen);
}

function sanitizeImportResult(modulePath, err) {
  if (!err) {
    return { module: modulePath, ok: true, errorName: '', errorMessage: '' };
  }
  return {
    module: modulePath,
    ok: false,
    errorName: boundedString(err && err.name ? err.name : 'Error', 80),
    errorMessage: boundedString(err && err.message ? err.message : '', 200)
  };
}

function loadDiagnosticModules() {
  const results = [];
  for (let i = 0; i < DIAGNOSTIC_MODULE_PATHS.length; i += 1) {
    const modulePath = DIAGNOSTIC_MODULE_PATHS[i];
    try {
      require(modulePath);
      results.push(sanitizeImportResult(modulePath, null));
    } catch (err) {
      results.push(sanitizeImportResult(modulePath, err));
    }
  }
  return results;
}

function createRateLimiter() {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const now = Date.now();
    const ip = getClientIp(req);
    const current = hits.get(ip);
    if (!current || current.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return next();
    }
    if (current.count >= RATE_LIMIT_MAX) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ ok: false, error: 'rate_limited', retryAfter: retryAfter });
    }
    current.count += 1;
    return next();
  };
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function safeRetryAfterSeconds(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const rounded = Math.ceil(value);
  return rounded < 0 ? null : rounded;
}

function makeErrorResponse(status, error, extra) {
  const payload = { ok: false, error: error };
  if (extra && typeof extra.retryAfter === 'number') payload.retryAfter = extra.retryAfter;
  return { status: status, body: payload };
}

function mapGeminiError(err, errorCodes) {
  const code = err && err.code;
  const EC = errorCodes || {};
  if (code === EC.UPSTREAM_401) return makeErrorResponse(401, 'upstream_auth_failed');
  if (code === EC.UPSTREAM_403) return makeErrorResponse(403, 'upstream_forbidden');
  if (code === EC.UPSTREAM_429) {
    const retryAfter = safeRetryAfterSeconds(err && err.retryAfter);
    return makeErrorResponse(429, 'upstream_rate_limited', retryAfter === null ? null : { retryAfter: retryAfter });
  }
  if (code === EC.UPSTREAM_5XX) return makeErrorResponse(502, 'upstream_error');
  if (code === EC.MISSING_API_KEY) return makeErrorResponse(500, 'server_misconfigured');
  if (code === EC.TIMEOUT) return makeErrorResponse(504, 'upstream_timeout');
  return makeErrorResponse(502, 'upstream_unavailable');
}

function createApp(deps) {
  const app = express();
  const rateLimit = createRateLimiter();
  const injected = deps || {};

  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: JSON_LIMIT }));
  app.use(function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: function (res, filePath) {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      else res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));

  app.get('/healthz', function (req, res) {
    return res.status(200).json({ status: 'ok', service: 'pocketplan', uptime: process.uptime() });
  });

  app.get('/debug/imports', function (req, res) {
    return res.status(200).json(loadDiagnosticModules());
  });

  app.post('/api/chat', rateLimit, async function (req, res) {
    let validateInput;
    try {
      validateInput = injected.validateInput || require('./src/input-schema').validateInput;
    } catch (err) {
      return res.status(500).json(sanitizeImportResult('./src/input-schema', err));
    }

    const validated = validateInput(req.body);
    if (!validated.ok) {
      return res.status(400).json({ ok: false, error: 'invalid_input', details: validated.errors });
    }

    let geminiModule;
    let normalizePlan;
    let fallbackBuilder;
    try {
      geminiModule = injected.callGemini && injected.ERROR_CODES
        ? { callGemini: injected.callGemini, ERROR_CODES: injected.ERROR_CODES }
        : require('./src/gemini');
    } catch (err) {
      return res.status(500).json(sanitizeImportResult('./src/gemini', err));
    }
    try {
      normalizePlan = injected.normalize || require('./src/normalize').normalize;
    } catch (err) {
      return res.status(500).json(sanitizeImportResult('./src/normalize', err));
    }
    try {
      fallbackBuilder = injected.buildFallback || require('./src/fallback').buildFallback;
    } catch (err) {
      return res.status(500).json(sanitizeImportResult('./src/fallback', err));
    }

    const invokeGemini = geminiModule.callGemini;
    const errorCodes = geminiModule.ERROR_CODES || {};
    const input = validated.value;
    let modelVersion = MODEL;

    try {
      const geminiResult = await invokeGemini(input);
      modelVersion = geminiResult && geminiResult.modelVersion ? String(geminiResult.modelVersion) : MODEL;
      let plan;
      try {
        plan = normalizePlan(geminiResult.data, input);
      } catch (err) {
        plan = fallbackBuilder(input);
        return res.status(200).json({ ok: true, fallback: true, fallbackReason: 'normalize_failed', provider: PROVIDER, model: MODEL, modelVersion: modelVersion, plan: plan });
      }
      return res.status(200).json({ ok: true, fallback: false, provider: PROVIDER, model: MODEL, modelVersion: modelVersion, plan: plan });
    } catch (err) {
      if (err && err.code === errorCodes.PARSING) {
        modelVersion = err.modelVersion ? String(err.modelVersion) : MODEL;
        return res.status(200).json({ ok: true, fallback: true, fallbackReason: 'parse_failed', provider: PROVIDER, model: MODEL, modelVersion: modelVersion, plan: fallbackBuilder(input) });
      }
      const mapped = mapGeminiError(err || {}, errorCodes);
      if (typeof mapped.body.retryAfter === 'number') res.setHeader('Retry-After', String(mapped.body.retryAfter));
      return res.status(mapped.status).json(mapped.body);
    }
  });

  app.use(function jsonErrorHandler(err, req, res, next) {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'payload_too_large' });
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) return res.status(400).json({ ok: false, error: 'invalid_json' });
    return next(err);
  });
  app.use(function finalErrorHandler(err, req, res, next) {
    return res.status(500).json({ ok: false, error: 'internal_error' });
  });
  return app;
}

const app = createApp();
if (require.main === module) {
  app.listen(PORT, function () {
    console.log('PocketPlan listening on port ' + PORT);
  });
}
module.exports = app;
module.exports.default = app;
module.exports.createApp = createApp;
