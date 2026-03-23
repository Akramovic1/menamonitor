import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';

type StrikeType = 'ballistic' | 'cruise' | 'drone' | 'airstrike';
type StrikeResult = 'hit' | 'intercepted' | 'failed';

export interface MissileEvent {
  id: string;
  timestamp: string;
  type: StrikeType;
  origin: string;
  originCountry: string;
  target: string;
  targetCountry: string;
  result: StrikeResult;
  lat?: number;
  lon?: number;
  source?: string;
}

const TYPE_ICONS: Record<StrikeType, string> = {
  ballistic: '🚀', cruise: '✈️', drone: '🛩️', airstrike: '💣',
};
const RESULT_ICONS: Record<StrikeResult, { icon: string; cls: string }> = {
  hit: { icon: '❌', cls: 'missile-result--hit' },
  intercepted: { icon: '✅', cls: 'missile-result--intercepted' },
  failed: { icon: '⚫', cls: 'missile-result--failed' },
};
const COUNTRY_FLAGS: Record<string, string> = {
  Iran: '🇮🇷', Israel: '🇮🇱', Lebanon: '🇱🇧', Syria: '🇸🇾',
  Yemen: '🇾🇪', Iraq: '🇮🇶', Palestine: '🇵🇸', Jordan: '🇯🇴',
};
const REFRESH_MS = 5 * 60 * 1000;

export class MissileTrackerPanel extends Panel {
  private events: MissileEvent[] = [];
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'missile-tracker',
      title: t('panels.missileTracker'),
      infoTooltip: t('panels.missileTrackerTooltip'),
      showCount: true,
      defaultRowSpan: 2,
    });
    this.showLoading(t('common.loading'));
    void this.fetchData();
    this.refreshTimer = setInterval(() => void this.fetchData(), REFRESH_MS);
  }

  public async fetchData(): Promise<void> {
    try {
      const [seedRes, apiRes] = await Promise.allSettled([
        fetch('/data/missile-events.json').then(r => r.ok ? r.json() : null),
        fetch('/api/conflict-extract.js').then(r => r.ok ? r.json() : null),
      ]);
      const seed = seedRes.status === 'fulfilled' ? seedRes.value : null;
      const api = apiRes.status === 'fulfilled' ? apiRes.value : null;
      this.mergeEvents(seed, api);
      this.render();
    } catch {
      if (this.events.length === 0) {
        this.showError(t('panels.missileTrackerError'), () => void this.fetchData());
      }
    }
  }

  private mergeEvents(seed: { events?: MissileEvent[] } | null, api: { events?: MissileEvent[] } | null): void {
    const all = new Map<string, MissileEvent>();
    for (const e of (seed?.events || [])) all.set(e.id, e);
    for (const e of (api?.events || [])) all.set(e.id, e);
    this.events = [...all.values()].sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  private buildSummary(): HTMLElement {
    let totalLaunched = 0;
    let totalIntercepted = 0;
    const bySide: Record<string, { launched: number; intercepted: number }> = {};

    for (const e of this.events) {
      totalLaunched++;
      if (e.result === 'intercepted') totalIntercepted++;
      const side = e.originCountry;
      if (!bySide[side]) bySide[side] = { launched: 0, intercepted: 0 };
      bySide[side].launched++;
      if (e.result === 'intercepted') bySide[side].intercepted++;
    }

    const hitRate = totalLaunched > 0 ? Math.round(((totalLaunched - totalIntercepted) / totalLaunched) * 100) : 0;

    return h('div', { className: 'missile-summary' },
      h('div', { className: 'missile-stat' },
        h('div', { className: 'missile-stat-value' }, String(totalLaunched)),
        h('div', { className: 'missile-stat-label' }, t('panels.totalLaunched')),
      ),
      h('div', { className: 'missile-stat' },
        h('div', { className: 'missile-stat-value' }, String(totalIntercepted)),
        h('div', { className: 'missile-stat-label' }, t('panels.totalIntercepted')),
      ),
      h('div', { className: 'missile-stat' },
        h('div', { className: 'missile-stat-value' }, `${hitRate}%`),
        h('div', { className: 'missile-stat-label' }, t('panels.hitRate')),
      ),
    );
  }

  private buildEventCard(event: MissileEvent): HTMLElement {
    const typeIcon = TYPE_ICONS[event.type] || '💥';
    const result = RESULT_ICONS[event.result] || RESULT_ICONS.failed;
    const originFlag = COUNTRY_FLAGS[event.originCountry] || '';
    const targetFlag = COUNTRY_FLAGS[event.targetCountry] || '';

    const card = h('div', { className: 'missile-event' },
      h('div', { className: 'missile-event-time' }, this.formatTime(event.timestamp)),
      h('div', { className: 'missile-event-body' },
        h('span', { className: 'missile-type' }, `${typeIcon} ${escapeHtml(event.type)}`),
        h('span', { className: 'missile-route' },
          `${originFlag} ${escapeHtml(event.origin)} → ${targetFlag} ${escapeHtml(event.target)}`),
        h('span', { className: `missile-result ${result.cls}` }, `${result.icon} ${escapeHtml(event.result)}`),
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

  private formatTime(ts: string): string {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  private render(): void {
    this.setCount(this.events.length);
    this.setErrorState(false);

    if (this.events.length === 0) {
      replaceChildren(this.content,
        h('div', { className: 'missile-container' },
          this.buildSummary(),
          h('div', { className: 'empty-state' }, t('panels.noMissileEvents')),
        ),
      );
      return;
    }

    replaceChildren(this.content,
      h('div', { className: 'missile-container' },
        this.buildSummary(),
        h('div', { className: 'missile-timeline' },
          ...this.events.map(e => this.buildEventCard(e)),
        ),
      ),
    );
  }

  public update(events: MissileEvent[]): void {
    this.events = events.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    this.render();
  }

  public destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
