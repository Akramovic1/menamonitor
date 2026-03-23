import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import type { NewsItem } from '@/types';

type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface AnalysisResult {
  summary: string;
  developments: string[];
  socialMood: string;
  riskLevel: RiskLevel;
  riskReasoning: string;
}

const REFRESH_MS = 30 * 60 * 1000; // 30 minutes
const RISK_COLORS: Record<RiskLevel, string> = {
  LOW: '#22c55e',
  MEDIUM: '#eab308',
  HIGH: '#f97316',
  CRITICAL: '#ef4444',
};

export class AiAnalysisPanel extends Panel {
  private result: AnalysisResult | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdated: Date | null = null;
  private pendingArticles: NewsItem[] = [];
  private analyzing = false;

  constructor() {
    super({
      id: 'ai-analysis',
      title: t('panels.aiAnalysis') || 'AI Conflict Analysis',
      infoTooltip: t('panels.aiAnalysisTooltip') || 'AI-generated neutral analysis of the current conflict situation based on all available intelligence.',
      showCount: false,
    });
    this.showLoading('Analyzing conflict situation...');
    this.refreshTimer = setInterval(() => void this.analyze(), REFRESH_MS);
  }

  /** Called by the app when new articles arrive */
  public updateArticles(articles: NewsItem[]): void {
    this.pendingArticles = articles;
    void this.analyze();
  }

  private async analyze(): Promise<void> {
    if (this.analyzing) return;
    const articles = this.pendingArticles;
    if (articles.length === 0) {
      if (!this.result) this.renderFallback();
      return;
    }

    this.analyzing = true;

    try {
      const headlines = articles
        .sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime())
        .slice(0, 15)
        .map(a => a.title);

      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headlines }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (data?.summary) {
        this.result = {
          summary: data.summary,
          developments: Array.isArray(data.developments) ? data.developments : [],
          socialMood: data.socialMood || '',
          riskLevel: data.riskLevel || 'MEDIUM',
          riskReasoning: data.riskReasoning || '',
        };
        this.lastUpdated = new Date();
        this.render();
      } else if (!this.result) {
        this.renderFallback();
      }
    } catch {
      if (!this.result) this.renderFallback();
    } finally {
      this.analyzing = false;
    }
  }

  private renderFallback(): void {
    this.setErrorState(false);
    replaceChildren(this.content,
      h('div', { className: 'ai-analysis-fallback' },
        h('div', { className: 'ai-analysis-fallback-icon' }, '🤖'),
        h('p', {}, 'Waiting for news data to generate analysis...'),
        h('p', { className: 'ai-analysis-hint' }, 'The AI will analyze the latest conflict headlines and provide a neutral briefing.'),
      ),
    );
  }

  private render(): void {
    if (!this.result) return;
    this.setErrorState(false);

    const r = this.result;
    const riskColor = RISK_COLORS[r.riskLevel] || RISK_COLORS.MEDIUM;

    const children: HTMLElement[] = [];

    // Risk badge
    const riskBadge = h('div', { className: 'ai-analysis-risk' },
      h('span', {
        className: 'ai-analysis-risk-badge',
        style: `background: ${riskColor}; color: ${r.riskLevel === 'LOW' ? '#000' : '#fff'}`,
      }, r.riskLevel),
      h('span', { className: 'ai-analysis-risk-text' }, escapeHtml(r.riskReasoning)),
    );
    children.push(riskBadge);

    // Summary
    children.push(
      h('div', { className: 'ai-analysis-summary' },
        h('p', {}, escapeHtml(r.summary)),
      ),
    );

    // Key developments
    if (r.developments.length > 0) {
      children.push(
        h('div', { className: 'ai-analysis-section' },
          h('h4', {}, 'Key Developments'),
          h('ul', { className: 'ai-analysis-list' },
            ...r.developments.map(d => h('li', {}, escapeHtml(d))),
          ),
        ),
      );
    }

    // Social mood
    if (r.socialMood) {
      children.push(
        h('div', { className: 'ai-analysis-mood' },
          h('span', { className: 'ai-analysis-mood-label' }, 'Social Mood: '),
          h('em', {}, escapeHtml(r.socialMood)),
        ),
      );
    }

    // Last updated + refresh button
    const footer = h('div', { className: 'ai-analysis-footer' },
      h('span', { className: 'ai-analysis-timestamp' },
        `Updated: ${this.lastUpdated ? this.lastUpdated.toLocaleTimeString() : 'N/A'}`,
      ),
    );

    const refreshBtn = h('button', {
      className: 'ai-analysis-refresh-btn',
      title: 'Refresh analysis',
    }, '↻ Refresh');
    refreshBtn.addEventListener('click', () => {
      this.showLoading('Re-analyzing...');
      void this.analyze();
    });
    footer.appendChild(refreshBtn);
    children.push(footer);

    replaceChildren(this.content,
      h('div', { className: 'ai-analysis-content' }, ...children),
    );
  }

  public destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
