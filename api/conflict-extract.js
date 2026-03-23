/**
 * Conflict Event Extraction API — Vercel Edge Function
 * Extracts structured conflict events from news articles
 * for the Iran-Israel conflict monitor.
 *
 * POST /api/conflict-extract
 * Body: { headline, body?, source, side? }
 * Returns: { events: [...], scorecard_update: {...} }
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const EXTRACT_SYSTEM_PROMPT = `You are a conflict event extractor for the Iran-Israel conflict monitor. Extract structured event data from this news article. Only extract concrete, factual events — not opinions or predictions. Be strictly impartial — never favor Iran or Israel. Distinguish verified facts from unverified claims. Note propaganda risk of the source. Acknowledge uncertainty when evidence is incomplete.

Respond in JSON only:
{
  "events": [
    {
      "type": "strike|missile|interception|diplomacy|humanitarian|escalation|de-escalation|naval|cyber|other",
      "title": "short event title",
      "description": "1-2 sentence factual description",
      "side": "iran|israel|both|neutral",
      "date": "ISO date if mentioned, or null",
      "location": { "name": "place name", "lat": null, "lon": null },
      "casualties": { "military": 0, "civilian": 0, "reported_by": "source" },
      "verified": false,
      "severity": "low|medium|high|critical"
    }
  ],
  "scorecard_update": {
    "side": "iran|israel|null",
    "strikes_launched": 0,
    "missiles_intercepted": 0,
    "facilities_hit": 0
  }
}

If the article contains no concrete conflict events, return: { "events": [], "scorecard_update": null }`;

const EVENT_CACHE_TTL = 21600; // 6h
const SCORECARD_TTL = 86400; // 24h for daily accumulator

const EMPTY_RESULT = { events: [], scorecard_update: null };

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseJsonSafe(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

async function readFromRedis(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.result) return null;
    return JSON.parse(data.result);
  } catch {
    return null;
  }
}

async function writeToRedis(key, value, ttlSeconds) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    await fetch(
      `${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}/EX/${ttlSeconds}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      },
    );
  } catch {
    // Non-fatal
  }
}

async function updateScorecardAccumulator(scorecardUpdate) {
  if (!scorecardUpdate || !scorecardUpdate.side) return;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  const side = scorecardUpdate.side; // 'iran' or 'israel'
  const pipeline = [];

  if (scorecardUpdate.strikes_launched > 0) {
    pipeline.push(['HINCRBY', 'mena:scorecard:daily', `${side}:strikesLaunched`, String(scorecardUpdate.strikes_launched)]);
  }
  if (scorecardUpdate.missiles_intercepted > 0) {
    pipeline.push(['HINCRBY', 'mena:scorecard:daily', `${side}:missilesIntercepted`, String(scorecardUpdate.missiles_intercepted)]);
  }
  if (scorecardUpdate.facilities_hit > 0) {
    pipeline.push(['HINCRBY', 'mena:scorecard:daily', `${side}:facilitiesDestroyed`, String(scorecardUpdate.facilities_hit)]);
  }

  if (pipeline.length === 0) return;

  // Also set TTL on the hash
  pipeline.push(['EXPIRE', 'mena:scorecard:daily', String(SCORECARD_TTL)]);

  try {
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Non-fatal
  }
}

async function addToTimeline(events, hash) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || events.length === 0) return;

  const pipeline = [];
  const now = Date.now();

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const member = JSON.stringify({ ...event, _hash: hash, _idx: i });
    const score = event.date ? new Date(event.date).getTime() || now : now;
    pipeline.push(['ZADD', 'mena:timeline', String(score), member]);
  }

  // Keep timeline from growing unbounded — trim to last 500 events
  pipeline.push(['ZREMRANGEBYRANK', 'mena:timeline', '0', '-501']);
  // Set TTL on the sorted set (7 days)
  pipeline.push(['EXPIRE', 'mena:timeline', '604800']);

  try {
    await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-fatal
  }
}

async function callGroq(headline, source, side, articleBody) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { ...EMPTY_RESULT, error: 'groq_not_configured' };

  const userContent = [
    `Headline: ${headline}`,
    source ? `Source: ${source}` : '',
    side ? `Source side: ${side}` : '',
    articleBody ? `Article excerpt: ${articleBody.slice(0, 1500)}` : '',
  ].filter(Boolean).join('\n');

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: EXTRACT_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (resp.status === 429) {
      return { ...EMPTY_RESULT, error: 'rate_limited' };
    }
    if (!resp.ok) {
      return { ...EMPTY_RESULT, error: `groq_error_${resp.status}` };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { ...EMPTY_RESULT, error: 'empty_response' };

    const parsed = parseJsonSafe(content);
    if (!parsed) return { ...EMPTY_RESULT, error: 'parse_error' };

    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      scorecard_update: parsed.scorecard_update || null,
    };
  } catch (err) {
    if (err.name === 'AbortError') return { ...EMPTY_RESULT, error: 'timeout' };
    return { ...EMPTY_RESULT, error: 'groq_fetch_error' };
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const rateLimitResult = await checkRateLimit(req, cors);
  if (rateLimitResult) return rateLimitResult;

  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ...EMPTY_RESULT, error: 'invalid_json' }, 400, cors);
  }

  const { headline, body: articleBody, source, side } = body || {};
  if (!headline || typeof headline !== 'string' || headline.trim().length === 0) {
    return jsonResponse({ ...EMPTY_RESULT, error: 'headline_required' }, 400, cors);
  }

  const trimmedHeadline = headline.trim().slice(0, 500);

  try {
    const hash = await sha256(trimmedHeadline);
    const cacheKey = `mena:event:${hash}`;

    // Check cache
    const cached = await readFromRedis(cacheKey);
    if (cached) {
      return jsonResponse({ ...cached, cached: true }, 200, cors);
    }

    // Extract events via Groq
    const result = await callGroq(trimmedHeadline, source, side, articleBody);

    // Cache result
    if (!result.error) {
      await writeToRedis(cacheKey, result, EVENT_CACHE_TTL);
    }

    // Fire-and-forget: update scorecard and timeline
    if (result.events.length > 0) {
      // Don't await — these are background operations
      updateScorecardAccumulator(result.scorecard_update).catch(() => {});
      addToTimeline(result.events, hash).catch(() => {});
    }

    return jsonResponse({ ...result, cached: false }, 200, cors);
  } catch (err) {
    return jsonResponse({ ...EMPTY_RESULT, error: err.message }, 500, cors);
  }
}
