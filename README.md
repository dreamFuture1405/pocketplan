# PocketPlan

Plan a meal or outfit using what you already own. Full-stack web app with Gemini 2.5 Flash server-side, structured JSON output, and a dynamic UI that renders the plan as budget bars, option cards, warning badges, missing-item chips, a zero-waste score, an emergency banner, and a short public decision trace.

## Architecture

```text
frontend planner UI
   -> POST /api/chat (same-origin)
   -> backend validation + 60/hour/IP rate limit + 256kb body limit
   -> Google Gemini 2.5 Flash (server-side, responseSchema constrained)
   -> backend JSON parse / validate / normalize
   -> structured success or structured fallback
   -> frontend dynamic rendering
```

The browser never calls Google directly. The browser never sees the API key.

## Stack

- Node.js 18+ (built-in `fetch`, `AbortController`, `node:test`)
- Express 4 (only dependency)
- Google Gemini 2.5 Flash (`gemini-2.5-flash` model)
- Static HTML + CSS + JS frontend (no framework)

## Files

| File | Role |
|---|---|
| `package.json` | npm manifest (only dependency: express ^4.19.2) |
| `Dockerfile` | container build (`npm install --omit=dev`, no lockfile) |
| `server.js` | Express server, static files, `/healthz`, `/api/chat`, rate limit, error mapping |
| `src/input-schema.js` | request validation |
| `src/output-schema.js` | canonical output JSON schema |
| `src/gemini.js` | Gemini API call (server-side, responseSchema) |
| `src/normalize.js` | parse / validate / clamp model output |
| `src/fallback.js` | safe structured fallback when parsing or normalization fails |
| `public/index.html` | planner UI |
| `public/styles.css` | responsive styles |
| `public/app.js` | form submit, JSON render, localStorage session/history persistence, Clear |
| `test/api.test.js` | node:test unit tests |
| `README.md` | this file |

## Environment variables

- `GEMINI_API_KEY` (required at runtime): Google Gemini API key. Injected as a private server environment variable. Browser never sees it.
- `PORT` (optional): defaults to `8080`.

## API

### `GET /healthz`

Returns:

```json
{ "status": "ok", "service": "pocketplan", "uptime": 12.34 }
```

### `POST /api/chat`

Request body contract:

```json
{
  "mode": "meal",
  "budget": 20,
  "ownedItems": ["rice", "eggs"],
  "occasion": "weeknight dinner",
  "time": 30,
  "constraints": ["quick prep"]
}
```

Input constraints:

- `mode`: `meal` or `outfit`
- `budget`: finite number from `0` to `1000000`
- `ownedItems`: string array, up to `100` items
- `occasion`: non-empty string, up to `500` chars
- `time`: finite number from `0` to `1440`
- `constraints`: string array, up to `20` items

Normalized plan contract:

- `mode`
- `budgetTotal`
- `budgetUsed`
- `options`
- `warnings`
- `missingItems`
- `zeroWasteScore`
- `emergencyBanner`
- `publicDecisionTrace`

Successful normalized response:

```json
{
  "ok": true,
  "fallback": false,
  "provider": "Google Gemini",
  "model": "gemini-2.5-flash",
  "modelVersion": "gemini-2.5-flash",
  "plan": {
    "mode": "meal",
    "budgetTotal": 20,
    "budgetUsed": 12.5,
    "options": [],
    "warnings": [],
    "missingItems": [],
    "zeroWasteScore": 75,
    "emergencyBanner": { "active": false, "message": "" },
    "publicDecisionTrace": ["..."]
  }
}
```

Fallback behavior:

- Parsing failure from Gemini candidate text returns HTTP `200` with:
  - `ok: true`
  - `fallback: true`
  - `fallbackReason: "parse_failed"`
  - `provider`, `model`, `modelVersion`
  - `plan: buildFallback(input)`
- Valid JSON that fails normalization returns HTTP `200` with:
  - `fallbackReason: "normalize_failed"`

Transport/config failures do **not** return fallback `200`.

Error mapping:

- `400 { "ok": false, "error": "invalid_input", "details": [...] }`
- `401 { "ok": false, "error": "upstream_auth_failed" }`
- `403 { "ok": false, "error": "upstream_forbidden" }`
- `429 { "ok": false, "error": "rate_limited" | "upstream_rate_limited", "retryAfter": N }`
- `500 { "ok": false, "error": "server_misconfigured" }`
- `502 { "ok": false, "error": "upstream_error" | "upstream_unavailable" }`
- `504 { "ok": false, "error": "upstream_timeout" }`

## Setup

```bash
npm install --omit=dev
export GEMINI_API_KEY=your_key_here
node server.js
```

## Tests

```bash
npm test
```

Tests are self-contained and do not require a live Gemini key or network access.

## Caching

- `index.html`: `Cache-Control: public, max-age=0, must-revalidate`
- other static assets: `Cache-Control: public, max-age=31536000, immutable`

## Security

- Browser calls only same-origin `/api/chat`.
- Backend calls Gemini server-side with `x-goog-api-key` header.
- Prompt asks Gemini to treat user fields as untrusted data and ignore injection attempts.
- Server does not expose raw upstream messages, headers, bodies, stacks, or keys in public error JSON.
- No cookie, no session, no database.
- localStorage is browser-only and is rendered after reload from session/history.
