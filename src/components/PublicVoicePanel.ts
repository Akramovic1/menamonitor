import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';

type Sentiment = 'pro-iran' | 'pro-israel' | 'anti-war' | 'neutral' | 'humanitarian';

export interface VoicePost {
  id: string;
  text: string;
  source: string;
  sentiment: Sentiment;
  timestamp: string;
}

interface SentimentBreakdown {
  'pro-iran': number;
  'pro-israel': number;
  'anti-war': number;
  neutral: number;
  humanitarian: number;
}

const SENTIMENT_COLORS: Record<Sentiment, string> = {
  'pro-iran': '#e74c3c',
  'pro-israel': '#3498db',
  'anti-war': '#9b59b6',
  neutral: '#95a5a6',
  humanitarian: '#f39c12',
};
const SENTIMENT_LABELS: Record<Sentiment, string> = {
  'pro-iran': 'Pro-Iran',
  'pro-israel': 'Pro-Israel',
  'anti-war': 'Anti-War',
  neutral: 'Neutral',
  humanitarian: 'Humanitarian',
};

export class PublicVoicePanel extends Panel {
  private posts: VoicePost[] = [];
  private hasTelegramData = false;

  constructor() {
    super({
      id: 'public-voice',
      title: t('panels.publicVoice'),
      infoTooltip: t('panels.publicVoiceTooltip'),
      showCount: true,
    });
    this.showLoading(t('common.loading'));
    // Wait for data to be pushed from App
    setTimeout(() => {
      if (this.posts.length === 0 && !this.hasTelegramData) this.renderNoData();
    }, 3000);
  }

  private calculateBreakdown(): SentimentBreakdown {
    const breakdown: SentimentBreakdown = {
      'pro-iran': 0, 'pro-israel': 0, 'anti-war': 0, neutral: 0, humanitarian: 0,
    };
    for (const p of this.posts) {
      if (p.sentiment in breakdown) breakdown[p.sentiment]++;
    }
    return breakdown;
  }

  private buildSentimentGauge(breakdown: SentimentBreakdown): HTMLElement {
    const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
    if (total === 0) {
      return h('div', { className: 'voice-gauge voice-gauge--empty' }, t('panels.noSentimentData'));
    }

    const segments: HTMLElement[] = [];
    for (const [key, count] of Object.entries(breakdown)) {
      if (count === 0) continue;
      const pct = (count / total) * 100;
      segments.push(
        h('div', {
          className: 'voice-gauge-segment',
          style: `width:${pct}%;background:${SENTIMENT_COLORS[key as Sentiment]};`,
          title: `${SENTIMENT_LABELS[key as Sentiment]}: ${Math.round(pct)}%`,
        }),
      );
    }

    const legend = Object.entries(breakdown)
      .filter(([, count]) => count > 0)
      .map(([key, count]) => {
        const pct = Math.round((count / total) * 100);
        return h('span', { className: 'voice-legend-item' },
          h('span', { className: 'voice-legend-dot', style: `background:${SENTIMENT_COLORS[key as Sentiment]};` }),
          `${SENTIMENT_LABELS[key as Sentiment]} ${pct}%`,
        );
      });

    return h('div', { className: 'voice-gauge-wrapper' },
      h('div', { className: 'voice-gauge' }, ...segments),
      h('div', { className: 'voice-legend' }, ...legend),
    );
  }

  private buildFairnessIndicator(breakdown: SentimentBreakdown): HTMLElement {
    const proIran = breakdown['pro-iran'];
    const proIsrael = breakdown['pro-israel'];
    const total = proIran + proIsrael;
    if (total === 0) return h('span');

    const ratio = Math.abs(proIran - proIsrael) / total;
    let label: string;
    let cls: string;
    if (ratio < 0.2) { label = t('panels.balanced'); cls = 'voice-fairness--balanced'; }
    else if (ratio < 0.5) { label = t('panels.slightlySkewed'); cls = 'voice-fairness--skewed'; }
    else { label = t('panels.heavilySkewed'); cls = 'voice-fairness--heavy'; }

    return h('div', { className: `voice-fairness ${cls}` },
      `${t('panels.fairness')}: ${label}`,
    );
  }

  private buildPostCard(post: VoicePost): HTMLElement {
    const color = SENTIMENT_COLORS[post.sentiment] || SENTIMENT_COLORS.neutral;
    const label = SENTIMENT_LABELS[post.sentiment] || 'Unknown';
    const timeStr = this.formatTime(post.timestamp);

    return h('div', { className: 'voice-post' },
      h('div', { className: 'voice-post-header' },
        h('span', { className: 'voice-sentiment-badge', style: `background:${color};` }, label),
        h('span', { className: 'voice-post-source' }, escapeHtml(post.source)),
        h('span', { className: 'voice-post-time' }, timeStr),
      ),
      h('p', { className: 'voice-post-text' }, escapeHtml(post.text)),
    );
  }

  private formatTime(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.justNow') || 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  private renderNoData(): void {
    this.setErrorState(false);
    replaceChildren(this.content,
      h('div', { className: 'voice-no-data' },
        h('div', { className: 'voice-no-data-icon' }, '📢'),
        h('p', {}, t('panels.publicVoiceNoTelegram')),
      ),
    );
  }

  private render(): void {
    this.setCount(this.posts.length);
    this.setErrorState(false);

    if (this.posts.length === 0) {
      this.renderNoData();
      return;
    }

    const breakdown = this.calculateBreakdown();
    const sorted = [...this.posts].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    replaceChildren(this.content,
      h('div', { className: 'voice-container' },
        this.buildSentimentGauge(breakdown),
        this.buildFairnessIndicator(breakdown),
        h('div', { className: 'voice-feed' },
          ...sorted.slice(0, 50).map(p => this.buildPostCard(p)),
        ),
      ),
    );
  }

  public update(posts: VoicePost[]): void {
    this.posts = posts;
    this.hasTelegramData = true;
    this.render();
  }
}
