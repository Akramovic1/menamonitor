/**
 * Timeline Events API — Vercel Edge Function
 * Returns accumulated conflict timeline events from Redis sorted set.
 *
 * GET /api/timeline-events?since=ISO_DATE&limit=50
 * Returns: { events: [...], total: N, lastUpdated: "ISO" }
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';

export const config = { runtime: 'edge' };

async function readTimelineFromRedis(sinceTimestamp, limit) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return { events: [], total: 0 };

  try {
    // Use ZRANGEBYSCORE to get events since timestamp, with scores (timestamps)
    // Then reverse for newest-first
    const minScore = sinceTimestamp || '-inf';
    const maxScore = '+inf';

    const pipeline = [
      // Get events in score range with scores — fetch more than limit to get total count
      ['ZRANGEBYSCORE', 'mena:timeline', String(minScore), maxScore, 'WITHSCORES'],
      // Get total count of all events
      ['ZCARD', 'mena:timeline'],
    ];

    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return { events: [], total: 0 };

    const data = await resp.json();
    const rawEvents = data[0]?.result || [];
    const totalCount = data[1]?.result || 0;

    // ZRANGEBYSCORE WITHSCORES returns [member, score, member, score, ...]
    const events = [];
    for (let i = 0; i < rawEvents.length; i += 2) {
      try {
        const event = JSON.parse(rawEvents[i]);
        const score = parseInt(rawEvents[i + 1], 10);
        events.push({ ...event, _timestamp: score });
      } catch {
        // Skip malformed entries
      }
    }

    // Sort newest first
    events.sort((a, b) => (b._timestamp || 0) - (a._timestamp || 0));

    // Apply limit
    const limited = events.slice(0, limit);

    // Clean internal fields
    for (const event of limited) {
      delete event._hash;
      delete event._idx;
      delete event._timestamp;
    }

    return { events: limited, total: totalCount };
  } catch {
    return { events: [], total: 0 };
  }
}

export default async function handler(req) {
  const cors = getCorsHeaders(req, 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, cors);
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  const rateLimitResult = await checkRateLimit(req, cors);
  if (rateLimitResult) return rateLimitResult;

  try {
    const requestUrl = new URL(req.url);
    const sinceParam = requestUrl.searchParams.get('since');
    const limitParam = requestUrl.searchParams.get('limit');

    let sinceTimestamp = null;
    if (sinceParam) {
      const parsed = new Date(sinceParam).getTime();
      if (!isNaN(parsed)) sinceTimestamp = parsed;
    }

    const limit = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200);

    const { events, total } = await readTimelineFromRedis(sinceTimestamp, limit);

    const result = {
      events,
      total,
      lastUpdated: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (err) {
    return jsonResponse({ events: [], total: 0, error: err.message }, 500, cors);
  }
}
