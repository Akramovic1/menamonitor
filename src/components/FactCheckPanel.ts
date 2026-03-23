import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import type { NewsItem } from '@/types';
import { SOURCE_SIDES } from '@/config/feeds';

type VerificationStatus = 'verified' | 'disputed' | 'unverified' | 'false';

export interface FactCheckClaim {
  text: string;
  source: string;
  side: 'iran' | 'israel' | 'neutral';
  status: VerificationStatus;
  confidence: number;
  reasoning?: string;
  counter_sources?: string[];
  verificationSource?: string;
  verificationUrl?: string;
  timestamp: string;
}

const REFRESH_MS = 10 * 60 * 1000; // 10 minutes
const MAX_HEADLINES = 10;
const STATUS_BADGES: Record<VerificationStatus, { icon: string; label: string; cls: string }> = {
  verified: { icon: '✅', label: 'Verified', cls: 'factcheck-status--verified' },
  disputed: { icon: '⚠️', label: 'Disputed', cls: 'factcheck-status--disputed' },
  unverified: { icon: '❓', label: 'Unverified', cls: 'factcheck-status--unverified' },
  false: { icon: '❌', label: 'False', cls: 'factcheck-status--false' },
};
const SIDE_FLAGS: Record<string, string> = { iran: '🇮🇷', israel: '🇮🇱', neutral: '🌐' };

export class FactCheckPanel extends Panel {
  private claims: FactCheckClaim[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private pendingArticles: NewsItem[] = [];
  private analyzing = false;
  private checkedHeadlines = new Set<string>();

  constructor() {
    super({
      id: 'fact-check',
      title: t('panels.factCheck'),
      infoTooltip: t('panels.factCheckTooltip'),
      showCount: true,
    });
    this.showLoading(t('common.loading'));
    this.refreshTimer = setInterval(() => void this.analyzeArticles(), REFRESH_MS);
  }

  /** Called by the app when new articles arrive */
  public updateArticles(articles: NewsItem[]): void {
    this.pendingArticles = articles;
    void this.analyzeArticles();
  }

  private async analyzeArticles(): Promise<void> {
    if (this.analyzing) return;
    const articles = this.pendingArticles
      .filter(a => a.title && !this.checkedHeadlines.has(a.title))
      .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
      .slice(0, MAX_HEADLINES);

    if (articles.length === 0) {
      if (this.claims.length === 0) this.renderFallback();
      return;
    }

    this.analyzing = true;
    const newClaims: FactCheckClaim[] = [];

    const promises = articles.map(async (article) => {
      try {
        const side = SOURCE_SIDES[article.source] || 'neutral';
        const res = await fetch('/api/fact-check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            headline: article.title,
            source: article.source,
            side,
          }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data?.claims && Array.isArray(data.claims)) {
          for (const claim of data.claims) {
            newClaims.push({
              text: claim.text || '',
              source: article.source,
              side: claim.source_side || side,
              status: claim.status || 'unverified',
              confidence: typeof claim.confidence === 'number' ? claim.confidence : 0.5,
              reasoning: claim.reasoning,
              counter_sources: claim.counter_sources,
              timestamp: article.pubDate instanceof Date
                ? article.pubDate.toISOString()
                : new Date(article.pubDate).toISOString(),
            });
          }
          this.checkedHeadlines.add(article.title);
        }
      } catch {
        // Individual article failure is non-fatal
      }
    });

    await Promise.allSettled(promises);

    if (newClaims.length > 0) {
      // Merge with existing, deduplicate by text
      const existingTexts = new Set(this.claims.map(c => c.text));
      for (const c of newClaims) {
        if (!existingTexts.has(c.text)) {
          this.claims.push(c);
          existingTexts.add(c.text);
        }
      }
      this.render();
    } else if (this.claims.length === 0) {
      this.renderFallback();
    }

    this.analyzing = false;
  }

  /** Direct update with pre-formed claims */
  public update(claims: FactCheckClaim[]): void {
    this.claims = claims;
    this.render();
  }

  /** Legacy fetchData — kept for backward compat but now a no-op trigger */
  public async fetchData(): Promise<void> {
    void this.analyzeArticles();
  }

  private renderFallback(): void {
    this.setErrorState(false);
    replaceChildren(this.content,
      h('div', { className: 'factcheck-fallback' },
        h('div', { className: 'factcheck-fallback-icon' }, '🔍'),
        h('p', {}, t('panels.factCheckLoading')),
        h('p', { className: 'factcheck-fallback-hint' }, t('panels.factCheckHint')),
      ),
    );
  }

  private sortClaims(claims: FactCheckClaim[]): FactCheckClaim[] {
    const priorityOrder: Record<VerificationStatus, number> = { false: 0, disputed: 1, unverified: 2, verified: 3 };
    return [...claims].sort((a, b) => {
      const pa = priorityOrder[a.status] ?? 2;
      const pb = priorityOrder[b.status] ?? 2;
      if (pa !== pb) return pa - pb;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }

  private buildClaimCard(claim: FactCheckClaim): HTMLElement {
    const badge = STATUS_BADGES[claim.status] || STATUS_BADGES.unverified;
    const flag = SIDE_FLAGS[claim.side] || '🌐';

    const children: HTMLElement[] = [
      h('div', { className: 'factcheck-claim-header' },
        h('span', { className: 'factcheck-badge' }, `${badge.icon} ${badge.label}`),
        h('span', { className: 'factcheck-confidence' }, `${Math.round(claim.confidence * 100)}%`),
      ),
      h('p', { className: 'factcheck-text' }, escapeHtml(claim.text)),
      h('div', { className: 'factcheck-source' },
        h('span', {}, flag),
        h('span', {}, ` ${escapeHtml(claim.source)}`),
        h('span', { className: 'factcheck-time' }, this.formatTime(claim.timestamp)),
      ),
    ];

    if (claim.reasoning) {
      children.push(
        h('div', { className: 'factcheck-reasoning' }, escapeHtml(claim.reasoning)),
      );
    }

    if (claim.verificationSource) {
      children.push(
        h('div', { className: 'factcheck-verify' },
          h('span', {}, `${t('panels.verifiedBy')}: `),
          claim.verificationUrl
            ? h('a', {
                href: sanitizeUrl(claim.verificationUrl),
                target: '_blank',
                rel: 'noopener noreferrer',
              }, escapeHtml(claim.verificationSource))
            : h('span', {}, escapeHtml(claim.verificationSource)),
        ),
      );
    }

    return h('div', { className: `factcheck-claim ${badge.cls}` }, ...children);
  }

  private formatTime(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.justNow') || 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  private render(): void {
    const sorted = this.sortClaims(this.claims);
    this.setCount(sorted.length);
    this.setErrorState(false);

    if (sorted.length === 0) {
      replaceChildren(this.content, h('div', { className: 'empty-state' }, t('panels.noFactChecks')));
      return;
    }

    replaceChildren(this.content,
      h('div', { className: 'factcheck-list' }, ...sorted.map(c => this.buildClaimCard(c))),
    );
  }

  public destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
