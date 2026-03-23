import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { rssProxyUrl } from '@/utils';
import { t } from '@/services/i18n';

type SocialSide = 'iran' | 'israel' | 'neutral';
type SocialPlatform = 'reddit' | 'twitter';

interface SocialFeedSource {
  name: string;
  url: string;
  side: SocialSide;
  platform: SocialPlatform;
}

interface SocialPost {
  title: string;
  link: string;
  source: string;
  platform: SocialPlatform;
  side: SocialSide;
  timestamp: number;
}

const REDDIT_FEEDS: SocialFeedSource[] = [
  { name: 'r/iran', url: rssProxyUrl('https://www.reddit.com/r/iran/.rss'), side: 'iran', platform: 'reddit' },
  { name: 'r/Israel', url: rssProxyUrl('https://www.reddit.com/r/israel/.rss'), side: 'israel', platform: 'reddit' },
  { name: 'r/MiddleEastNews', url: rssProxyUrl('https://www.reddit.com/r/MiddleEastNews/.rss'), side: 'neutral', platform: 'reddit' },
  { name: 'r/geopolitics', url: rssProxyUrl('https://www.reddit.com/r/geopolitics/.rss'), side: 'neutral', platform: 'reddit' },
  { name: 'r/worldnews', url: rssProxyUrl('https://www.reddit.com/r/worldnews/search.rss?q=iran+israel&sort=new&t=day'), side: 'neutral', platform: 'reddit' },
];

const TWITTER_FEEDS: SocialFeedSource[] = [
  { name: 'Conflict News', url: rssProxyUrl('https://nitter.privacydev.net/conflicts/rss'), side: 'neutral', platform: 'twitter' },
  { name: 'IntelCrab', url: rssProxyUrl('https://nitter.privacydev.net/IntelCrab/rss'), side: 'neutral', platform: 'twitter' },
  { name: 'Iran Intl', url: rssProxyUrl('https://nitter.privacydev.net/IranIntl_En/rss'), side: 'iran', platform: 'twitter' },
];

const FALLBACK_FEEDS: SocialFeedSource[] = [
  { name: 'Reddit Iran-Israel', url: rssProxyUrl('https://news.google.com/rss/search?q=reddit+iran+israel+conflict+when:1d&hl=en-US'), side: 'neutral', platform: 'reddit' },
  { name: 'Twitter OSINT', url: rssProxyUrl('https://news.google.com/rss/search?q=twitter+iran+israel+OSINT+when:1d&hl=en-US'), side: 'neutral', platform: 'twitter' },
];

const ALL_FEEDS = [...REDDIT_FEEDS, ...TWITTER_FEEDS];
const MAX_POSTS = 30;

type TabFilter = 'all' | 'reddit' | 'twitter';

export class SocialPulsePanel extends Panel {
  private posts: SocialPost[] = [];
  private activeTab: TabFilter = 'all';
  private fetchInFlight = false;
  private usedFallback = false;

  constructor() {
    super({
      id: 'social-pulse',
      title: t('panels.socialPulse'),
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Aggregated social media discussion about the Iran-Israel conflict from Reddit and X/Twitter',
    });
    this.showLoading(t('common.loading'));
  }

  public async fetchData(): Promise<void> {
    if (this.fetchInFlight) return;
    this.fetchInFlight = true;
    try {
      const results = await this.fetchAllFeeds(ALL_FEEDS);

      if (results.length < 3 && !this.usedFallback) {
        this.usedFallback = true;
        const fallbackResults = await this.fetchAllFeeds(FALLBACK_FEEDS);
        results.push(...fallbackResults);
      }

      this.posts = results
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_POSTS);

      this.setCount(this.posts.length);
      this.render();
    } catch (err) {
      console.warn('[SocialPulse] fetch failed:', err);
      replaceChildren(this.content,
        h('div', { className: 'sp-empty' }, 'Social feeds temporarily unavailable'),
      );
    } finally {
      this.fetchInFlight = false;
    }
  }

  private async fetchAllFeeds(feeds: SocialFeedSource[]): Promise<SocialPost[]> {
    const results: SocialPost[] = [];
    const settled = await Promise.allSettled(
      feeds.map(feed => this.fetchFeed(feed))
    );
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      }
    }
    return results;
  }

  private async fetchFeed(feed: SocialFeedSource): Promise<SocialPost[]> {
    const resp = await fetch(feed.url);
    if (!resp.ok) return [];
    const text = await resp.text();
    return this.parseRSS(text, feed);
  }

  private parseRSS(xml: string, feed: SocialFeedSource): SocialPost[] {
    const posts: SocialPost[] = [];
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');

      // Atom format (Reddit)
      const entries = doc.querySelectorAll('entry');
      if (entries.length > 0) {
        for (const entry of entries) {
          const title = entry.querySelector('title')?.textContent?.trim();
          const link = entry.querySelector('link')?.getAttribute('href');
          const updated = entry.querySelector('updated')?.textContent;
          if (!title || !link) continue;
          posts.push({
            title, link,
            source: feed.name,
            platform: feed.platform,
            side: feed.side,
            timestamp: updated ? new Date(updated).getTime() : Date.now(),
          });
        }
        return posts;
      }

      // RSS 2.0 format
      const items = doc.querySelectorAll('item');
      for (const item of items) {
        const title = item.querySelector('title')?.textContent?.trim();
        const link = item.querySelector('link')?.textContent?.trim();
        const pubDate = item.querySelector('pubDate')?.textContent;
        if (!title || !link) continue;
        posts.push({
          title, link,
          source: feed.name,
          platform: feed.platform,
          side: feed.side,
          timestamp: pubDate ? new Date(pubDate).getTime() : Date.now(),
        });
      }
    } catch {
      // Silently ignore parse errors
    }
    return posts;
  }

  private formatRelativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  private buildSideBadge(side: SocialSide): HTMLElement {
    const labels: Record<SocialSide, string> = { iran: 'IR', israel: 'IL', neutral: 'N' };
    return h('span', { className: `sp-side-badge sp-side-badge--${side}` }, labels[side]);
  }

  private buildPlatformIcon(platform: SocialPlatform): HTMLElement {
    return h('span', { className: `sp-platform sp-platform--${platform}` },
      platform === 'reddit' ? 'R' : 'X',
    );
  }

  private buildPostCard(post: SocialPost): HTMLElement {
    return h('div', { className: `sp-post sp-post--${post.side}` },
      h('div', { className: 'sp-post-header' },
        this.buildPlatformIcon(post.platform),
        h('span', { className: 'sp-post-source' }, escapeHtml(post.source)),
        this.buildSideBadge(post.side),
        h('span', { className: 'sp-post-time' }, this.formatRelativeTime(post.timestamp)),
      ),
      h('a', {
        className: 'sp-post-title',
        href: sanitizeUrl(post.link),
        target: '_blank',
        rel: 'noopener noreferrer',
      }, escapeHtml(post.title)),
    );
  }

  private buildSentimentBar(filtered: SocialPost[]): HTMLElement {
    const total = filtered.length || 1;
    const iranCount = filtered.filter(p => p.side === 'iran').length;
    const israelCount = filtered.filter(p => p.side === 'israel').length;
    const neutralCount = filtered.filter(p => p.side === 'neutral').length;

    const iranPct = Math.round((iranCount / total) * 100);
    const israelPct = Math.round((israelCount / total) * 100);
    const neutralPct = 100 - iranPct - israelPct;

    return h('div', { className: 'sp-sentiment' },
      h('div', { className: 'sp-sentiment-bar' },
        ...(iranPct > 0 ? [h('div', {
          className: 'sp-sentiment-seg sp-sentiment-seg--iran',
          style: `width:${iranPct}%`,
        })] : []),
        ...(neutralPct > 0 ? [h('div', {
          className: 'sp-sentiment-seg sp-sentiment-seg--neutral',
          style: `width:${neutralPct}%`,
        })] : []),
        ...(israelPct > 0 ? [h('div', {
          className: 'sp-sentiment-seg sp-sentiment-seg--israel',
          style: `width:${israelPct}%`,
        })] : []),
      ),
      h('div', { className: 'sp-sentiment-labels' },
        h('span', { className: 'sp-sentiment-label sp-sentiment-label--iran' },
          h('span', { className: 'sp-sentiment-dot sp-sentiment-dot--iran' }),
          `Iran ${iranCount}`,
        ),
        h('span', { className: 'sp-sentiment-label sp-sentiment-label--neutral' },
          h('span', { className: 'sp-sentiment-dot sp-sentiment-dot--neutral' }),
          `Neutral ${neutralCount}`,
        ),
        h('span', { className: 'sp-sentiment-label sp-sentiment-label--israel' },
          h('span', { className: 'sp-sentiment-dot sp-sentiment-dot--israel' }),
          `Israel ${israelCount}`,
        ),
      ),
    );
  }

  private buildTab(filter: TabFilter, label: string, count: number): HTMLElement {
    const tab = h('button', {
      className: `sp-tab ${this.activeTab === filter ? 'sp-tab--active' : ''}`,
    }, `${label} (${count})`);
    tab.addEventListener('click', () => {
      this.activeTab = filter;
      this.render();
    });
    return tab;
  }

  private render(): void {
    const filtered = this.activeTab === 'all'
      ? this.posts
      : this.posts.filter(p => p.platform === this.activeTab);

    const allCount = this.posts.length;
    const redditCount = this.posts.filter(p => p.platform === 'reddit').length;
    const twitterCount = this.posts.filter(p => p.platform === 'twitter').length;

    if (this.posts.length === 0) {
      replaceChildren(this.content,
        h('div', { className: 'sp-empty' }, 'No social posts available'),
      );
      return;
    }

    const tabBar = h('div', { className: 'sp-tabs' },
      this.buildTab('all', 'All', allCount),
      this.buildTab('reddit', 'Reddit', redditCount),
      this.buildTab('twitter', 'X', twitterCount),
    );

    const postList = h('div', { className: 'sp-posts' },
      ...filtered.map(post => this.buildPostCard(post)),
    );

    replaceChildren(this.content,
      h('div', { className: 'sp-content' },
        tabBar,
        this.buildSentimentBar(filtered),
        postList,
      ),
    );
  }
}
