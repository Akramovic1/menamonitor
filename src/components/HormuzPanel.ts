import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';

type TransitStatus = 'normal' | 'elevated' | 'disrupted';

interface HormuzEvent {
  timestamp: string;
  type: string;
  description: string;
}

interface HormuzData {
  vesselCount: number;
  tankerCount: number;
  transitStatus: TransitStatus;
  events: HormuzEvent[];
  oilPrice?: number;
  oilPriceChange?: number;
}

const STATUS_INDICATOR: Record<TransitStatus, { icon: string; label: string; cls: string }> = {
  normal: { icon: '🟢', label: 'Normal', cls: 'hormuz-status--normal' },
  elevated: { icon: '🟡', label: 'Elevated Risk', cls: 'hormuz-status--elevated' },
  disrupted: { icon: '🔴', label: 'Disrupted', cls: 'hormuz-status--disrupted' },
};

// Strait of Hormuz bounding box
const HORMUZ_BBOX = { minLat: 25.5, maxLat: 27.5, minLon: 54.5, maxLon: 57.5 };

export class HormuzPanel extends Panel {
  private data: HormuzData = {
    vesselCount: 0, tankerCount: 0, transitStatus: 'normal', events: [],
  };
  private aisAvailable = false;

  constructor() {
    super({
      id: 'hormuz-monitor',
      title: t('panels.hormuzMonitor'),
      infoTooltip: t('panels.hormuzMonitorTooltip'),
    });
    this.showLoading(t('common.loading'));
    // Initial render after a short delay to allow AIS data to arrive
    setTimeout(() => this.render(), 2000);
  }

  /** Called from App when AIS vessel data updates. */
  public updateVessels(vessels: Array<{ lat: number; lon: number; type?: string }>): void {
    this.aisAvailable = true;
    const inStrait = vessels.filter(v =>
      v.lat >= HORMUZ_BBOX.minLat && v.lat <= HORMUZ_BBOX.maxLat &&
      v.lon >= HORMUZ_BBOX.minLon && v.lon <= HORMUZ_BBOX.maxLon);

    this.data.vesselCount = inStrait.length;
    this.data.tankerCount = inStrait.filter(v => v.type === 'tanker' || v.type === 'oil_tanker').length;
    this.render();
  }

  /** Called with oil price data if available from energy services */
  public updateOilPrice(price: number, change: number): void {
    this.data.oilPrice = price;
    this.data.oilPriceChange = change;
    this.render();
  }

  /** Called with Hormuz-specific events extracted from news */
  public updateEvents(events: HormuzEvent[]): void {
    this.data.events = events.slice(0, 10);
    // Determine transit status from events
    if (events.some(e => e.type === 'seizure' || e.type === 'blockade')) {
      this.data.transitStatus = 'disrupted';
    } else if (events.some(e => e.type === 'escort' || e.type === 'irgc_encounter')) {
      this.data.transitStatus = 'elevated';
    } else {
      this.data.transitStatus = 'normal';
    }
    this.render();
  }

  private buildVesselWidget(): HTMLElement {
    if (!this.aisAvailable) {
      return h('div', { className: 'hormuz-widget hormuz-widget--disabled' },
        h('div', { className: 'hormuz-widget-icon' }, '🚢'),
        h('p', { className: 'hormuz-widget-msg' }, t('panels.hormuzNoAis')),
      );
    }
    return h('div', { className: 'hormuz-widget' },
      h('div', { className: 'hormuz-stat' },
        h('div', { className: 'hormuz-stat-value' }, String(this.data.vesselCount)),
        h('div', { className: 'hormuz-stat-label' }, t('panels.totalVessels')),
      ),
      h('div', { className: 'hormuz-stat' },
        h('div', { className: 'hormuz-stat-value' }, String(this.data.tankerCount)),
        h('div', { className: 'hormuz-stat-label' }, t('panels.oilTankers')),
      ),
    );
  }

  private buildStatusIndicator(): HTMLElement {
    const status = STATUS_INDICATOR[this.data.transitStatus];
    return h('div', { className: `hormuz-transit ${status.cls}` },
      h('span', {}, `${status.icon} ${t('panels.transitStatus')}: `),
      h('span', { className: 'hormuz-transit-label' }, status.label),
    );
  }

  private buildOilWidget(): HTMLElement {
    if (this.data.oilPrice == null) {
      return h('div', { className: 'hormuz-oil' },
        h('span', { className: 'hormuz-oil-label' }, `🛢️ ${t('panels.brentCrude')}`),
        h('span', { className: 'hormuz-oil-value' }, '—'),
      );
    }
    const changeStr = this.data.oilPriceChange != null
      ? `${this.data.oilPriceChange >= 0 ? '+' : ''}${this.data.oilPriceChange.toFixed(2)}%`
      : '';
    const changeCls = (this.data.oilPriceChange || 0) >= 0 ? 'hormuz-oil-up' : 'hormuz-oil-down';

    return h('div', { className: 'hormuz-oil' },
      h('span', { className: 'hormuz-oil-label' }, `🛢️ ${t('panels.brentCrude')}`),
      h('span', { className: 'hormuz-oil-value' }, `$${this.data.oilPrice.toFixed(2)}`),
      h('span', { className: `hormuz-oil-change ${changeCls}` }, changeStr),
    );
  }

  private buildEventLog(): HTMLElement {
    if (this.data.events.length === 0) {
      return h('div', { className: 'hormuz-events-empty' }, t('panels.noHormuzEvents'));
    }
    return h('div', { className: 'hormuz-events' },
      h('div', { className: 'hormuz-events-title' }, t('panels.recentEvents')),
      ...this.data.events.map(e =>
        h('div', { className: 'hormuz-event' },
          h('span', { className: 'hormuz-event-time' }, new Date(e.timestamp).toLocaleDateString()),
          h('span', { className: 'hormuz-event-type' }, escapeHtml(e.type)),
          h('span', { className: 'hormuz-event-desc' }, escapeHtml(e.description)),
        ),
      ),
    );
  }

  private render(): void {
    this.setErrorState(false);
    replaceChildren(this.content,
      h('div', { className: 'hormuz-container' },
        this.buildStatusIndicator(),
        h('div', { className: 'hormuz-widgets' },
          this.buildVesselWidget(),
          this.buildOilWidget(),
        ),
        this.buildEventLog(),
      ),
    );
  }
}
