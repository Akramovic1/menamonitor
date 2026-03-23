/**
 * Conflict Scorecard API — Vercel Edge Function
 * Returns the current Iran-Israel conflict scorecard with accumulated stats.
 *
 * GET /api/conflict-score
 * Returns: { lastUpdated, iran: {...}, israel: {...}, shipping: {...}, humanitarian: {...} }
 */

import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
import { jsonResponse } from './_json-response.js';
import { checkRateLimit } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const BASELINE_SCORECARD = {
  iran: {
    strikesLaunched: 348,
    strikesReceived: 127,
    missilesIntercepted: 284,
    facilitiesDestroyed: 43,
    casualties: { military: 312, civilian: 89 },
  },
  israel: {
    strikesLaunched: 892,
    strikesReceived: 348,
    missilesIntercepted: 198,
    facilitiesDestroyed: 67,
    casualties: { military: 156, civilian: 247 },
  },
  shipping: { hormuzDisruptions: 23, redSeaDisruptions: 147 },
  humanitarian: { displaced: 2450000, aidBlocked: true },
  proxies: {
    hezbollah: { strikesLaunched: 4200, strikesReceived: 3100, casualties: 1850 },
    houthis: { strikesLaunched: 892, shipsTargeted: 103, intercepted: 341 },
    iraqMilitias: { strikesLaunched: 189, basesTargeted: 42 },
  },
};

const SCORECARD_FIELDS = [
  'iran:strikesLaunched', 'iran:strikesReceived', 'iran:missilesIntercepted',
  'iran:facilitiesDestroyed', 'iran:casualties:military', 'iran:casualties:civilian',
  'israel:strikesLaunched', 'israel:strikesReceived', 'israel:missilesIntercepted',
  'israel:facilitiesDestroyed', 'israel:casualties:military', 'israel:casualties:civilian',
  'shipping:hormuzDisruptions', 'shipping:redSeaDisruptions',
  'humanitarian:displaced',
  'proxies:hezbollah:strikesLaunched', 'proxies:hezbollah:strikesReceived', 'proxies:hezbollah:casualties',
  'proxies:houthis:strikesLaunched', 'proxies:houthis:shipsTargeted', 'proxies:houthis:intercepted',
  'proxies:iraqMilitias:strikesLaunched', 'proxies:iraqMilitias:basesTargeted',
];

async function readScorecardFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const pipeline = [['HGETALL', 'mena:scorecard:daily']];
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const result = data[0]?.result;
    if (!result || !Array.isArray(result) || result.length === 0) return null;

    // HGETALL returns [field, value, field, value, ...]
    const hash = {};
    for (let i = 0; i < result.length; i += 2) {
      hash[result[i]] = parseInt(result[i + 1], 10) || 0;
    }
    return hash;
  } catch {
    return null;
  }
}

function mergeScorecard(redisHash) {
  const scorecard = JSON.parse(JSON.stringify(BASELINE_SCORECARD));

  if (!redisHash) return scorecard;

  // Redis values are ACCUMULATED on top of the baseline (additive merge)
  for (const field of SCORECARD_FIELDS) {
    const value = redisHash[field];
    if (value === undefined) continue;

    const parts = field.split(':');
    if (parts.length === 2) {
      scorecard[parts[0]][parts[1]] = (scorecard[parts[0]][parts[1]] || 0) + value;
    } else if (parts.length === 3) {
      scorecard[parts[0]][parts[1]][parts[2]] = (scorecard[parts[0]][parts[1]][parts[2]] || 0) + value;
    }
  }

  // Cross-reference: Iran's strikes launched = Israel's strikes received
  scorecard.iran.strikesReceived = scorecard.israel.strikesLaunched;
  scorecard.israel.strikesReceived = scorecard.iran.strikesLaunched;

  return scorecard;
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
    const redisHash = await readScorecardFromRedis();
    const scorecard = mergeScorecard(redisHash);

    const result = {
      lastUpdated: new Date().toISOString(),
      ...scorecard,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=1800',
      },
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500, cors);
  }
}
