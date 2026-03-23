import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';

type Trend = 'up' | 'down' | 'stable';

interface SideStats {
  strikesLaunched: number;
  strikesReceived: number;
  missilesIntercepted: number;
  facilitiesDestroyed: number;
  casualtiesMilitary: number;
  casualtiesCivilian: number;
  trends: Record<string, Trend>;
}

interface SharedStats {
  shippingDisruptions: number;
  oilPriceImpactPercent: number;
  humanitarianIncidents: number;
  displacedPersons: number;
}

export interface ScorecardData {
  updatedAt: string;
  iran: SideStats;
  israel: SideStats;
  shared: SharedStats;
}

const REFRESH_MS = 5 * 60 * 1000;

export class ConflictScorecardPanel extends Panel {
  private data: ScorecardData | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'conflict-scorecard',
      title: t('panels.conflictScorecard'),
      infoTooltip: t('panels.conflictScorecardTooltip'),
      defaultRowSpan: 2,
    });
    this.showLoading(t('common.loading'));
    void this.fetchData();
    this.refreshTimer = setInterval(() => void this.fetchData(), REFRESH_MS);
  }

  public async fetchData(): Promise<void> {
    try {
      const [seedRes, apiRes] = await Promise.allSettled([
        fetch('/data/conflict-scorecard.json').then(r => r.ok ? r.json() : null),
        fetch('/api/conflict-extract.js').then(r => r.ok ? r.json() : null),
      ]);
      const seed = seedRes.status === 'fulfilled' ? seedRes.value : null;
      const api = apiRes.status === 'fulfilled' ? apiRes.value : null;
      this.data = this.mergeData(seed, api);
      this.render();
    } catch {
      if (!this.data) {
        this.showError(t('panels.conflictScorecardError'), () => void this.fetchData());
      }
    }
  }

  private mergeData(seed: ScorecardData | null, api: unknown): ScorecardData {
    if (!seed) {
      return this.emptyScorecard();
    }
    // API data would enrich seed — for now just use seed
    if (api && typeof api === 'object' && 'iran' in (api as Record<string, unknown>)) {
      return api as ScorecardData;
    }
    return seed;
  }

  private emptyScorecard(): ScorecardData {
    const side = (): SideStats => ({
      strikesLaunched: 0, strikesReceived: 0, missilesIntercepted: 0,
      facilitiesDestroyed: 0, casualtiesMilitary: 0, casualtiesCivilian: 0,
      trends: { strikesLaunched: 'stable', strikesReceived: 'stable', missilesIntercepted: 'stable',
        facilitiesDestroyed: 'stable', casualtiesMilitary: 'stable', casualtiesCivilian: 'stable' },
    });
    return {
      updatedAt: new Date().toISOString(),
      iran: side(), israel: side(),
      shared: { shippingDisruptions: 0, oilPriceImpactPercent: 0, humanitarianIncidents: 0, displacedPersons: 0 },
    };
  }

  private trendArrow(trend: Trend): HTMLElement {
    if (trend === 'up') return h('span', { className: 'scorecard-trend scorecard-trend--up' }, '↑');
    if (trend === 'down') return h('span', { className: 'scorecard-trend scorecard-trend--down' }, '↓');
    return h('span', { className: 'scorecard-trend scorecard-trend--stable' }, '→');
  }

  private severityClass(value: number): string {
    if (value >= 100) return 'scorecard-severity--high';
    if (value >= 10) return 'scorecard-severity--medium';
    return 'scorecard-severity--low';
  }

  private buildMetric(label: string, value: number, trend: Trend): HTMLElement {
    return h('div', { className: `scorecard-metric ${this.severityClass(value)}` },
      h('div', { className: 'scorecard-metric-label' }, label),
      h('div', { className: 'scorecard-metric-value' },
        h('span', {}, String(value)),
        this.trendArrow(trend),
      ),
    );
  }

  private buildSide(label: string, flag: string, stats: SideStats): HTMLElement {
    return h('div', { className: 'scorecard-side' },
      h('div', { className: 'scorecard-side-header' },
        h('span', { className: 'scorecard-flag' }, flag),
        h('span', { className: 'scorecard-side-label' }, label),
      ),
      this.buildMetric(t('panels.strikesLaunched'), stats.strikesLaunched, (stats.trends.strikesLaunched as Trend) || 'stable'),
      this.buildMetric(t('panels.strikesReceived'), stats.strikesReceived, (stats.trends.strikesReceived as Trend) || 'stable'),
      this.buildMetric(t('panels.missilesIntercepted'), stats.missilesIntercepted, (stats.trends.missilesIntercepted as Trend) || 'stable'),
      this.buildMetric(t('panels.facilitiesDestroyed'), stats.facilitiesDestroyed, (stats.trends.facilitiesDestroyed as Trend) || 'stable'),
      this.buildMetric(t('panels.casualtiesMilitary'), stats.casualtiesMilitary, (stats.trends.casualtiesMilitary as Trend) || 'stable'),
      this.buildMetric(t('panels.casualtiesCivilian'), stats.casualtiesCivilian, (stats.trends.casualtiesCivilian as Trend) || 'stable'),
    );
  }

  private buildShared(stats: SharedStats): HTMLElement {
    return h('div', { className: 'scorecard-shared' },
      h('div', { className: 'scorecard-shared-title' }, t('panels.sharedImpact')),
      h('div', { className: 'scorecard-shared-grid' },
        h('div', { className: 'scorecard-shared-item' },
          h('span', { className: 'scorecard-shared-label' }, t('panels.shippingDisruptions')),
          h('span', { className: 'scorecard-shared-value' }, String(stats.shippingDisruptions)),
        ),
        h('div', { className: 'scorecard-shared-item' },
          h('span', { className: 'scorecard-shared-label' }, t('panels.oilPriceImpact')),
          h('span', { className: 'scorecard-shared-value' }, `${stats.oilPriceImpactPercent > 0 ? '+' : ''}${stats.oilPriceImpactPercent}%`),
        ),
        h('div', { className: 'scorecard-shared-item' },
          h('span', { className: 'scorecard-shared-label' }, t('panels.humanitarianIncidents')),
          h('span', { className: 'scorecard-shared-value' }, String(stats.humanitarianIncidents)),
        ),
        h('div', { className: 'scorecard-shared-item' },
          h('span', { className: 'scorecard-shared-label' }, t('panels.displacedPersons')),
          h('span', { className: 'scorecard-shared-value' }, stats.displacedPersons.toLocaleString()),
        ),
      ),
    );
  }

  private render(): void {
    if (!this.data) {
      replaceChildren(this.content, h('div', { className: 'empty-state' }, t('panels.noScorecardData')));
      return;
    }
    this.setErrorState(false);

    const container = h('div', { className: 'scorecard-container' },
      h('div', { className: 'scorecard-sides' },
        this.buildSide(t('panels.iran'), '🇮🇷', this.data.iran),
        h('div', { className: 'scorecard-divider' }),
        this.buildSide(t('panels.israel'), '🇮🇱', this.data.israel),
      ),
      this.buildShared(this.data.shared),
    );

    replaceChildren(this.content, container);
  }

  public update(data: ScorecardData): void {
    this.data = data;
    this.render();
  }

  public destroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }
}
