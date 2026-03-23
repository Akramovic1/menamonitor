import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { escapeHtml } from '@/utils/sanitize';
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
  engagement?: string;
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

      // If we got very few results, try fallback feeds
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
      this.setContent(`<div class="panel-empty">Social feeds temporarily unavailable</div>`);
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

      // Try Atom format first (Reddit uses Atom)
      const entries = doc.querySelectorAll('entry');
      if (entries.length > 0) {
        for (const entry of entries) {
          const title = entry.querySelector('title')?.textContent?.trim();
          const link = entry.querySelector('link')?.getAttribute('href');
          const updated = entry.querySelector('updated')?.textContent;
          if (!title || !link) continue;
          posts.push({
            title,
            link,
            source: feed.name,
            platform: feed.platform,
            side: feed.side,
            timestamp: updated ? new Date(updated).getTime() : Date.now(),
          });
        }
        return posts;
      }

      // Try RSS 2.0 format
      const items = doc.querySelectorAll('item');
      for (const item of items) {
        const title = item.querySelector('title')?.textContent?.trim();
        const link = item.querySelector('link')?.textContent?.trim();
        const pubDate = item.querySelector('pubDate')?.textContent;
        if (!title || !link) continue;
        posts.push({
          title,
          link,
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

  private getSideBadge(side: SocialSide): string {
    switch (side) {
      case 'iran': return '<span class="social-side-badge social-side-iran" title="Iran-related">IR</span>';
      case 'israel': return '<span class="social-side-badge social-side-israel" title="Israel-related">IL</span>';
      default: return '<span class="social-side-badge social-side-neutral" title="Neutral">N</span>';
    }
  }

  private getPlatformIcon(platform: SocialPlatform): string {
    return platform === 'reddit' ? 'R' : 'X';
  }

  private render(): void {
    const filtered = this.activeTab === 'all'
      ? this.posts
      : this.posts.filter(p => p.platform === this.activeTab);

    if (filtered.length === 0) {
      this.setContent(`<div class="panel-empty">No social posts available</div>`);
      return;
    }

    // Tab bar
    const tabBar = h('div', { className: 'social-tabs' },
      this.createTab('all', 'All'),
      this.createTab('reddit', 'Reddit'),
      this.createTab('twitter', 'X'),
    );

    // Sentiment summary
    const iranCount = filtered.filter(p => p.side === 'iran').length;
    const israelCount = filtered.filter(p => p.side === 'israel').length;
    const neutralCount = filtered.filter(p => p.side === 'neutral').length;
    const total = filtered.length;

    const sentimentBar = h('div', { className: 'social-sentiment' },
      h('div', { className: 'social-sentiment-bar' },
        h('div', {
          className: 'social-sentiment-segment social-sentiment-iran',
          style: `width:${Math.round((iranCount / total) * 100)}%`,
        }),
        h('div', {
          className: 'social-sentiment-segment social-sentiment-neutral',
          style: `width:${Math.round((neutralCount / total) * 100)}%`,
        }),
        h('div', {
          className: 'social-sentiment-segment social-sentiment-israel',
          style: `width:${Math.round((israelCount / total) * 100)}%`,
        }),
      ),
      h('div', { className: 'social-sentiment-labels' },
        h('span', {}, `Iran: ${iranCount}`),
        h('span', {}, `Neutral: ${neutralCount}`),
        h('span', {}, `Israel: ${israelCount}`),
      ),
    );

    // Post list
    const postList = h('div', { className: 'social-posts' },
      ...filtered.map(post => {
        const row = h('div', { className: `social-post social-post-${post.side}` },
          h('div', { className: 'social-post-meta' },
            h('span', { className: `social-platform social-platform-${post.platform}` }, this.getPlatformIcon(post.platform)),
            h('span', { className: 'social-source' }, escapeHtml(post.source)),
            h('span', { className: 'social-time' }, this.formatRelativeTime(post.timestamp)),
          ),
          h('a', {
            className: 'social-post-title',
            href: post.link,
            target: '_blank',
            rel: 'noopener noreferrer',
          }, escapeHtml(post.title)),
          h('div', { className: 'social-post-badges' },
          ),
        );
        // Inject side badge as raw HTML
        const badgeEl = row.querySelector('.social-post-badges');
        if (badgeEl) badgeEl.innerHTML = this.getSideBadge(post.side);
        return row;
      }),
    );

    const content = h('div', { className: 'social-pulse-content' },
      tabBar,
      sentimentBar,
      postList,
    );

    replaceChildren(this.content, content);
  }

  private createTab(filter: TabFilter, label: string): HTMLElement {
    const tab = h('button', {
      className: `social-tab ${this.activeTab === filter ? 'social-tab-active' : ''}`,
    }, label);
    tab.addEventListener('click', () => {
      this.activeTab = filter;
      this.render();
    });
    return tab;
  }
}
