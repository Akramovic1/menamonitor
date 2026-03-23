import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { getSourceSide, getSourcePropagandaRisk, getSourceTier } from '@/config/feeds';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import type { NewsItem } from '@/types';

type Side = 'iran' | 'neutral' | 'israel';

const MENA_KEYWORDS = [
  'iran', 'israel', 'gaza', 'hamas', 'hezbollah', 'houthi', 'yemen',
  'hormuz', 'tehran', 'tel aviv', 'jerusalem', 'beirut', 'syria',
  'iraq', 'saudi', 'gulf', 'middle east', 'mena', 'idf', 'irgc',
  'missile', 'strike', 'nuclear', 'sanctions', 'red sea', 'suez',
  'lebanon', 'netanyahu', 'khamenei', 'drone', 'ceasefire', 'escalat',
  'west bank', 'rafah', 'houthis', 'nasrallah', 'quds', 'palestinian',
  'zionist', 'ayatollah', 'kurdish', 'peshmerga', 'tikrit', 'mosul',
];

function isMenaRelevant(article: NewsItem): boolean {
  // Articles from Iran/Israel sources are always relevant
  const side = getSourceSide(article.source);
  if (side !== 'neutral') return true;

  // For neutral sources, check headline for MENA keywords
  const text = (article.title + ' ' + article.source).toLowerCase();
  return MENA_KEYWORDS.some(kw => text.includes(kw));
}

export class TwoSidedNewsPanel extends Panel {
  private articles: NewsItem[] = [];
  private activeTab: Side = 'neutral';
  private isMobile = window.innerWidth < 768;
  private resizeHandler: (() => void) | null = null;

  constructor() {
    super({
      id: 'two-sided-news',
      title: t('panels.twoSidedNews'),
      infoTooltip: t('panels.twoSidedNewsTooltip'),
      defaultRowSpan: 2,
    });
    this.showLoading(t('common.loading'));
    this.resizeHandler = () => {
      const wasMobile = this.isMobile;
      this.isMobile = window.innerWidth < 768;
      if (wasMobile !== this.isMobile && this.articles.length > 0) this.render();
    };
    window.addEventListener('resize', this.resizeHandler);
  }

  private classifyArticle(item: NewsItem): Side {
    return getSourceSide(item.source);
  }

  private propagandaRiskDot(source: string): HTMLElement {
    const risk = getSourcePropagandaRisk(source);
    const colorMap = { high: '#ff4444', medium: '#ffaa00', low: '#44aa44' };
    const color = colorMap[risk.risk] || colorMap.low;
    return h('span', {
      className: 'two-sided-risk-dot',
      style: `background:${color};`,
      title: `${t('panels.propagandaRisk')}: ${risk.risk}${risk.note ? ' — ' + risk.note : ''}`,
    });
  }

  private tierBadge(source: string): HTMLElement {
    const tier = getSourceTier(source);
    return h('span', { className: `two-sided-tier two-sided-tier--${tier}` }, `T${tier}`);
  }

  private relativeTime(date: Date): string {
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.justNow') || 'just now';
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  }

  private buildArticleCard(item: NewsItem): HTMLElement {
    const link = h('a', {
      className: 'two-sided-headline',
      href: sanitizeUrl(item.link),
      target: '_blank',
      rel: 'noopener noreferrer',
    }, escapeHtml(item.title));

    return h('div', { className: 'two-sided-article' },
      link,
      h('div', { className: 'two-sided-meta' },
        this.propagandaRiskDot(item.source),
        h('span', { className: 'two-sided-source' }, escapeHtml(item.source)),
        this.tierBadge(item.source),
        h('span', { className: 'two-sided-time' }, this.relativeTime(item.pubDate)),
      ),
    );
  }

  private buildColumn(side: Side, label: string, items: NewsItem[]): HTMLElement {
    const cards = items.length > 0
      ? items.slice(0, 20).map(a => this.buildArticleCard(a))
      : [h('div', { className: 'empty-state' }, t('panels.noArticles'))];

    return h('div', { className: `two-sided-column two-sided-column--${side}` },
      h('div', { className: 'two-sided-column-header' }, label),
      ...cards,
    );
  }

  private buildTabs(grouped: Record<Side, NewsItem[]>): HTMLElement {
    const sides: Side[] = ['iran', 'neutral', 'israel'];
    const labels: Record<Side, string> = {
      iran: `🇮🇷 ${t('panels.iranSources')}`,
      neutral: `🌐 ${t('panels.neutralSources')}`,
      israel: `🇮🇱 ${t('panels.israelSources')}`,
    };

    const tabBar = h('div', { className: 'two-sided-tabs' },
      ...sides.map(side => {
        const tab = h('button', {
          className: `two-sided-tab ${side === this.activeTab ? 'two-sided-tab--active' : ''}`,
          dataset: { side },
        }, `${labels[side]} (${grouped[side].length})`);
        tab.addEventListener('click', () => {
          this.activeTab = side;
          this.render();
        });
        return tab;
      }),
    );

    const items = grouped[this.activeTab];
    const cards = items.length > 0
      ? items.slice(0, 30).map(a => this.buildArticleCard(a))
      : [h('div', { className: 'empty-state' }, t('panels.noArticles'))];

    return h('div', { className: 'two-sided-mobile' },
      tabBar,
      h('div', { className: 'two-sided-tab-content' }, ...cards),
    );
  }

  private render(): void {
    const menaArticles = this.articles.filter(isMenaRelevant);
    const grouped: Record<Side, NewsItem[]> = { iran: [], neutral: [], israel: [] };
    for (const a of menaArticles) {
      const side = this.classifyArticle(a);
      grouped[side].push(a);
    }
    // Sort each group by date (newest first)
    for (const side of Object.values(grouped)) {
      side.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    }

    this.setErrorState(false);
    const total = menaArticles.length;
    this.setCount(total);

    if (total === 0) {
      replaceChildren(this.content, h('div', { className: 'empty-state' }, t('panels.noTwoSidedNews')));
      return;
    }

    if (this.isMobile) {
      replaceChildren(this.content, this.buildTabs(grouped));
    } else {
      replaceChildren(this.content,
        h('div', { className: 'two-sided-columns' },
          this.buildColumn('iran', `🇮🇷 ${t('panels.iranSources')}`, grouped.iran),
          this.buildColumn('neutral', `🌐 ${t('panels.neutralSources')}`, grouped.neutral),
          this.buildColumn('israel', `🇮🇱 ${t('panels.israelSources')}`, grouped.israel),
        ),
      );
    }
  }

  public update(articles: NewsItem[]): void {
    this.articles = articles;
    this.render();
  }

  public destroy(): void {
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
  }
}
