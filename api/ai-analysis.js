/**
 * AI Conflict Analysis API — Vercel Edge Function
 * Generates a neutral AI summary of the current Iran-Israel conflict situation
 * based on the latest news headlines and social signals.
 *
 * POST /api/ai-analysis
 * Body: { headlines: string[], socialPosts?: string[], ciiScores?: { iran: number, israel: number } }
 * Returns: { summary, developments, socialMood, riskLevel, riskReasoning, cached }
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const ANALYSIS_SYSTEM_PROMPT = `You are a neutral conflict analyst for the MENA Monitor — an Iran-Israel conflict intelligence dashboard. Based on the latest news headlines and social media, provide a concise analytical briefing. Be strictly impartial — never favor Iran or Israel. Acknowledge uncertainty. Present both sides.

Respond in JSON only:
{
  "summary": "3-4 sentence situation summary (strictly neutral, current state of the conflict)",
  "developments": ["top 3-5 key developments in bullet form"],
  "socialMood": "one-line summary of public sentiment from social/Reddit sources",
  "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
  "riskReasoning": "brief 1-2 sentence explanation of the risk level"
}`;

const CACHE_TTL = 1800; // 30 minutes

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
    // Redis write failure is non-fatal
  }
}

const FALLBACK = {
  summary: 'Analysis temporarily unavailable. The AI analysis service requires recent news headlines to generate a conflict briefing.',
  developments: [],
  socialMood: 'No social data available',
  riskLevel: 'MEDIUM',
  riskReasoning: 'Unable to assess — no data available',
};

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'forbidden' }, 403, cors);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'method_not_allowed' }, 405, cors);
  }

  const rl = await checkRateLimit(req, cors);
  if (rl) return rl;

  try {
    const body = await req.json();
    const { headlines = [], socialPosts = [], ciiScores } = body;

    if (!Array.isArray(headlines) || headlines.length === 0) {
      return jsonResponse({ ...FALLBACK, cached: false }, 200, cors);
    }

    // Build cache key from sorted headlines
    const headlineKey = headlines.slice(0, 10).sort().join('|');
    const cacheKey = `mena:analysis:${(await sha256(headlineKey)).slice(0, 24)}`;

    // Check Redis cache
    const cached = await readFromRedis(cacheKey);
    if (cached) {
      return jsonResponse({ ...cached, cached: true }, 200, {
        ...cors,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
      });
    }

    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      return jsonResponse({ ...FALLBACK, error: 'groq_not_configured', cached: false }, 200, cors);
    }

    const userContent = [
      `Latest news headlines:\n${headlines.slice(0, 15).map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
      socialPosts.length > 0 ? `\nSocial media posts:\n${socialPosts.slice(0, 5).join('\n')}` : '',
      ciiScores ? `\nCountry Instability Index — Iran: ${ciiScores.iran}, Israel: ${ciiScores.israel}` : '',
    ].filter(Boolean).join('\n');

    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (resp.status === 429) {
      return jsonResponse({ ...FALLBACK, error: 'rate_limited', cached: false }, 200, cors);
    }

    if (!resp.ok) {
      return jsonResponse({ ...FALLBACK, error: `groq_error_${resp.status}`, cached: false }, 200, cors);
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return jsonResponse({ ...FALLBACK, error: 'empty_response', cached: false }, 200, cors);
    }

    const parsed = parseJsonSafe(content);
    if (!parsed || !parsed.summary) {
      return jsonResponse({ ...FALLBACK, error: 'parse_error', cached: false }, 200, cors);
    }

    const result = {
      summary: parsed.summary || '',
      developments: Array.isArray(parsed.developments) ? parsed.developments : [],
      socialMood: parsed.socialMood || 'No social data available',
      riskLevel: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(parsed.riskLevel) ? parsed.riskLevel : 'MEDIUM',
      riskReasoning: parsed.riskReasoning || '',
    };

    // Cache the result
    await writeToRedis(cacheKey, result, CACHE_TTL);

    return jsonResponse({ ...result, cached: false }, 200, {
      ...cors,
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=600',
    });
  } catch (err) {
    return jsonResponse({ ...FALLBACK, error: String(err?.message || err), cached: false }, 500, cors);
  }
}
