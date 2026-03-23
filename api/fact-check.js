/**
 * Fact-Check API — Vercel Edge Function
 * AI-analyzes news headlines to extract and verify factual claims
 * for the Iran-Israel conflict monitor.
 *
 * POST /api/fact-check
 * Body: { headline, source, side, body? }
 * Returns: { claims: [...], cached: bool }
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const FACT_CHECK_SYSTEM_PROMPT = `You are a neutral fact-checker for the Iran-Israel conflict. Analyze this news headline and extract factual claims. For each claim, assess whether it can be verified by cross-referencing with known facts. Be strictly impartial — never favor Iran or Israel. Distinguish verified facts from unverified claims. Note propaganda risk of the source. Acknowledge uncertainty when evidence is incomplete.

Respond in JSON only:
{
  "claims": [
    {
      "text": "the factual claim",
      "source_side": "iran|israel|neutral",
      "status": "verified|disputed|unverified|false",
      "confidence": 0.0-1.0,
      "reasoning": "brief explanation",
      "counter_sources": ["source names that confirm or deny"]
    }
  ]
}`;

const CACHE_TTL = 21600; // 6 hours

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parseJsonSafe(text) {
  // Strip markdown fences if present
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
    // Redis write failure is non-fatal
  }
}

async function callGroq(headline, source, side, body) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return { claims: [], error: 'groq_not_configured' };

  const userContent = [
    `Headline: ${headline}`,
    source ? `Source: ${source}` : '',
    side ? `Source side: ${side}` : '',
    body ? `Article excerpt: ${body.slice(0, 1000)}` : '',
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
          { role: 'system', content: FACT_CHECK_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (resp.status === 429) {
      return { claims: [], error: 'rate_limited' };
    }

    if (!resp.ok) {
      return { claims: [], error: `groq_error_${resp.status}` };
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return { claims: [], error: 'empty_response' };

    const parsed = parseJsonSafe(content);
    if (!parsed || !Array.isArray(parsed.claims)) {
      return { claims: [], error: 'parse_error' };
    }

    return { claims: parsed.claims };
  } catch (err) {
    if (err.name === 'AbortError') return { claims: [], error: 'timeout' };
    return { claims: [], error: 'groq_fetch_error' };
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
    return jsonResponse({ claims: [], error: 'invalid_json' }, 400, cors);
  }

  const { headline, source, side, body: articleBody } = body || {};
  if (!headline || typeof headline !== 'string' || headline.trim().length === 0) {
    return jsonResponse({ claims: [], error: 'headline_required' }, 400, cors);
  }

  const trimmedHeadline = headline.trim().slice(0, 500);

  try {
    // Check cache
    const hash = await sha256(trimmedHeadline);
    const cacheKey = `mena:factcheck:${hash}`;
    const cached = await readFromRedis(cacheKey);
    if (cached) {
      return jsonResponse({ ...cached, cached: true }, 200, cors);
    }

    // Call Groq for analysis
    const result = await callGroq(trimmedHeadline, source, side, articleBody);

    // Cache successful results
    if (result.claims.length > 0 || !result.error) {
      await writeToRedis(cacheKey, result, CACHE_TTL);
    }

    return jsonResponse({ ...result, cached: false }, 200, cors);
  } catch (err) {
    return jsonResponse({ claims: [], error: err.message }, 500, cors);
  }
}
