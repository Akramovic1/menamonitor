import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

type EventType = 'strike' | 'diplomacy' | 'humanitarian' | 'escalation' | 'de-escalation' | 'other';

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  description: string;
  type: EventType;
  sourceUrl?: string;
  sourceName?: string;
  lat?: number;
  lon?: number;
}

const EVENT_COLORS: Record<EventType, { dot: string; label: string }> = {
  strike: { dot: '#ff4444', label: '🔴 Military Strike' },
  diplomacy: { dot: '#3388ff', label: '🔵 Diplomacy' },
  humanitarian: { dot: '#ffcc00', label: '🟡 Humanitarian' },
  escalation: { dot: '#ff8800', label: '🟠 Escalation' },
  'de-escalation': { dot: '#44aa44', label: '🟢 De-escalation' },
  other: { dot: '#888888', label: '⚪ Other' },
};

export class WarTimelinePanel extends Panel {
  private events: TimelineEvent[] = [];
  private lastUpdated: number = 0;

  constructor() {
    super({
      id: 'war-timeline',
      title: t('panels.warTimeline'),
      infoTooltip: t('panels.warTimelineTooltip'),
      showCount: true,
      defaultRowSpan: 2,
    });
    this.showLoading(t('common.loading'));
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    try {
      const res = await fetch('/data/key-events-timeline.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.events && Array.isArray(data.events)) {
        this.mergeEvents(data.events);
        this.lastUpdated = Date.now();
        this.render();
      }
    } catch {
      if (this.events.length === 0) {
        this.showError(t('panels.warTimelineError'), () => void this.fetchData());
      }
    }
  }

  private mergeEvents(newEvents: TimelineEvent[]): void {
    const map = new Map<string, TimelineEvent>();
    for (const e of this.events) map.set(e.id, e);
    for (const e of newEvents) map.set(e.id, e);
    this.events = [...map.values()].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private buildLastUpdated(): HTMLElement {
    if (!this.lastUpdated) return h('span');
    const mins = Math.floor((Date.now() - this.lastUpdated) / 60000);
    const text = mins < 1 ? t('common.justNow') || 'just now' : `${mins}m ago`;
    return h('div', { className: 'timeline-updated' },
      `${t('panels.lastUpdated')}: ${text}`,
    );
  }

  private buildEventCard(event: TimelineEvent): HTMLElement {
    const color = EVENT_COLORS[event.type] || EVENT_COLORS.other;
    const dateStr = new Date(event.date).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    });

    const sourceEl = event.sourceUrl
      ? h('a', {
          className: 'timeline-source',
          href: sanitizeUrl(event.sourceUrl),
          target: '_blank',
          rel: 'noopener noreferrer',
        }, escapeHtml(event.sourceName || 'Source'))
      : event.sourceName
        ? h('span', { className: 'timeline-source' }, escapeHtml(event.sourceName))
        : null;

    const card = h('div', { className: 'timeline-event' },
      h('div', { className: 'timeline-dot', style: `background:${color.dot};` }),
      h('div', { className: 'timeline-event-content' },
        h('div', { className: 'timeline-date' }, dateStr),
        h('div', { className: 'timeline-title' }, escapeHtml(event.title)),
        h('div', { className: 'timeline-desc' }, escapeHtml(event.description)),
        ...(sourceEl ? [sourceEl] : []),
      ),
    );

    if (event.lat != null && event.lon != null) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        document.dispatchEvent(new CustomEvent('mena:flyto', {
          detail: { lat: event.lat, lon: event.lon, zoom: 7 },
        }));
      });
    }

    return card;
  }

  private render(): void {
    this.setCount(this.events.length);
    this.setErrorState(false);

    if (this.events.length === 0) {
      replaceChildren(this.content,
        h('div', { className: 'timeline-container' },
          this.buildLastUpdated(),
          h('div', { className: 'empty-state' }, t('panels.noTimelineEvents')),
        ),
      );
      return;
    }

    const container = h('div', { className: 'timeline-container' },
      this.buildLastUpdated(),
      h('div', { className: 'timeline-line' },
        ...this.events.map(e => this.buildEventCard(e)),
      ),
    );

    replaceChildren(this.content, container);

    // Auto-scroll to top (newest event)
    this.content.scrollTop = 0;
  }

  public update(events: TimelineEvent[]): void {
    this.mergeEvents(events);
    this.lastUpdated = Date.now();
    this.render();
  }
}
