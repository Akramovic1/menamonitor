/**
 * Conflict extraction service — fires async requests to /api/conflict-extract
 * to populate the scorecard and timeline when MENA-relevant articles are detected.
 *
 * This is fire-and-forget — failures are silently ignored to avoid
 * blocking the main news classification pipeline.
 */

import { getRpcBaseUrl } from '@/services/rpc-client';

const DEDUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const MAX_PENDING = 10;
const recentlyExtracted = new Map<string, number>();
let pendingCount = 0;

function toDedupeKey(headline: string): string {
  return headline.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pruneDedupeMap(): void {
  const now = Date.now();
  for (const [key, ts] of recentlyExtracted) {
    if (now - ts > DEDUP_WINDOW_MS) recentlyExtracted.delete(key);
  }
}

export async function triggerConflictExtraction(
  headline: string,
  source?: string,
  side?: string,
): Promise<void> {
  if (!headline || pendingCount >= MAX_PENDING) return;

  const key = toDedupeKey(headline);
  const now = Date.now();

  pruneDedupeMap();
  if (recentlyExtracted.has(key)) return;
  recentlyExtracted.set(key, now);

  pendingCount++;
  try {
    const baseUrl = getRpcBaseUrl();
    await fetch(`${baseUrl}/api/conflict-extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        headline: headline.slice(0, 500),
        source: source || undefined,
        side: side || undefined,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    // Fire-and-forget — silently ignore errors
  } finally {
    pendingCount--;
  }
}
