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

interface HezbollahStats {
  strikesLaunched: number;
  strikesReceived: number;
  casualties: number;
}

interface HouthiStats {
  strikesLaunched: number;
  shipsTargeted: number;
  intercepted: number;
}

interface IraqMilitiaStats {
  strikesLaunched: number;
  basesTargeted: number;
}

interface ProxyStats {
  hezbollah: HezbollahStats;
  houthis: HouthiStats;
  iraqMilitias: IraqMilitiaStats;
}

export interface ScorecardData {
  updatedAt?: string;
  lastUpdated?: string;
  baselineNote?: string;
  iran: SideStats;
  israel: SideStats;
  shared: SharedStats;
  proxies?: ProxyStats;
}

const REFRESH_MS = 5 * 60 * 1000;

export class ConflictScorecardPanel extends Panel {
  private data: ScorecardData | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private proxiesExpanded = false;

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
        fetch('/api/conflict-score').then(r => r.ok ? r.json() : null),
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

  private mergeData(seed: ScorecardData | null, api: ScorecardData | null): ScorecardData {
    if (!seed) return api || this.emptyScorecard();
    if (!api) return seed;

    // Merge: baseline seed + live API accumulated data
    const merged: ScorecardData = {
      updatedAt: api.lastUpdated || api.updatedAt || seed.updatedAt || new Date().toISOString(),
      baselineNote: seed.baselineNote,
      iran: this.mergeSide(seed.iran, api.iran),
      israel: this.mergeSide(seed.israel, api.israel),
      shared: this.mergeShared(seed.shared, api.shared),
      proxies: this.mergeProxies(seed.proxies, api.proxies),
    };
    return merged;
  }

  private mergeSide(seed: SideStats, live?: Partial<SideStats>): SideStats {
    if (!live) return seed;
    return {
      strikesLaunched: seed.strikesLaunched + (live.strikesLaunched || 0),
      strikesReceived: seed.strikesReceived + (live.strikesReceived || 0),
      missilesIntercepted: seed.missilesIntercepted + (live.missilesIntercepted || 0),
      facilitiesDestroyed: seed.facilitiesDestroyed + (live.facilitiesDestroyed || 0),
      casualtiesMilitary: seed.casualtiesMilitary + (live.casualtiesMilitary || 0),
      casualtiesCivilian: seed.casualtiesCivilian + (live.casualtiesCivilian || 0),
      trends: live.trends || seed.trends,
    };
  }

  private mergeShared(seed: SharedStats, live?: Partial<SharedStats>): SharedStats {
    if (!live) return seed;
    return {
      shippingDisruptions: seed.shippingDisruptions + (live.shippingDisruptions || 0),
      oilPriceImpactPercent: live.oilPriceImpactPercent ?? seed.oilPriceImpactPercent,
      humanitarianIncidents: seed.humanitarianIncidents + (live.humanitarianIncidents || 0),
      displacedPersons: seed.displacedPersons + (live.displacedPersons || 0),
    };
  }

  private mergeProxies(seed?: ProxyStats, live?: ProxyStats): ProxyStats {
    const base = seed || {
      hezbollah: { strikesLaunched: 0, strikesReceived: 0, casualties: 0 },
      houthis: { strikesLaunched: 0, shipsTargeted: 0, intercepted: 0 },
      iraqMilitias: { strikesLaunched: 0, basesTargeted: 0 },
    };
    if (!live) return base;
    return {
      hezbollah: {
        strikesLaunched: base.hezbollah.strikesLaunched + (live.hezbollah?.strikesLaunched || 0),
        strikesReceived: base.hezbollah.strikesReceived + (live.hezbollah?.strikesReceived || 0),
        casualties: base.hezbollah.casualties + (live.hezbollah?.casualties || 0),
      },
      houthis: {
        strikesLaunched: base.houthis.strikesLaunched + (live.houthis?.strikesLaunched || 0),
        shipsTargeted: base.houthis.shipsTargeted + (live.houthis?.shipsTargeted || 0),
        intercepted: base.houthis.intercepted + (live.houthis?.intercepted || 0),
      },
      iraqMilitias: {
        strikesLaunched: base.iraqMilitias.strikesLaunched + (live.iraqMilitias?.strikesLaunched || 0),
        basesTargeted: base.iraqMilitias.basesTargeted + (live.iraqMilitias?.basesTargeted || 0),
      },
    };
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
      proxies: {
        hezbollah: { strikesLaunched: 0, strikesReceived: 0, casualties: 0 },
        houthis: { strikesLaunched: 0, shipsTargeted: 0, intercepted: 0 },
        iraqMilitias: { strikesLaunched: 0, basesTargeted: 0 },
      },
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

  private buildMetric(label: string, value: number, trend?: Trend): HTMLElement {
    return h('div', { className: `scorecard-metric ${this.severityClass(value)}` },
      h('div', { className: 'scorecard-metric-label' }, label),
      h('div', { className: 'scorecard-metric-value' },
        h('span', {}, value.toLocaleString()),
        trend ? this.trendArrow(trend) : h('span', {}),
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

  private buildProxies(proxies: ProxyStats): HTMLElement {
    const toggleBtn = h('button', {
      className: 'scorecard-proxies-toggle',
      type: 'button',
    },
      h('span', {}, t('panels.proxyForces')),
      h('span', { className: `scorecard-proxies-arrow ${this.proxiesExpanded ? 'scorecard-proxies-arrow--open' : ''}` }, '▸'),
    );

    const proxyContent = h('div', {
      className: `scorecard-proxies-content ${this.proxiesExpanded ? 'scorecard-proxies-content--open' : ''}`,
    },
      // Hezbollah
      h('div', { className: 'scorecard-proxy-group' },
        h('div', { className: 'scorecard-proxy-header' },
          h('span', { className: 'scorecard-proxy-name' }, t('panels.proxyHezbollah')),
          h('span', { className: 'scorecard-proxy-side' }, '🇮🇷'),
        ),
        this.buildMetric(t('panels.strikesLaunched'), proxies.hezbollah.strikesLaunched),
        this.buildMetric(t('panels.strikesReceived'), proxies.hezbollah.strikesReceived),
        this.buildMetric(t('panels.casualties'), proxies.hezbollah.casualties),
      ),
      // Houthis
      h('div', { className: 'scorecard-proxy-group' },
        h('div', { className: 'scorecard-proxy-header' },
          h('span', { className: 'scorecard-proxy-name' }, t('panels.proxyHouthis')),
          h('span', { className: 'scorecard-proxy-side' }, '🇮🇷'),
        ),
        this.buildMetric(t('panels.strikesLaunched'), proxies.houthis.strikesLaunched),
        this.buildMetric(t('panels.shipsTargeted'), proxies.houthis.shipsTargeted),
        this.buildMetric(t('panels.missilesIntercepted'), proxies.houthis.intercepted),
      ),
      // Iraqi Militias
      h('div', { className: 'scorecard-proxy-group' },
        h('div', { className: 'scorecard-proxy-header' },
          h('span', { className: 'scorecard-proxy-name' }, t('panels.proxyIraqMilitias')),
          h('span', { className: 'scorecard-proxy-side' }, '🇮🇷'),
        ),
        this.buildMetric(t('panels.strikesLaunched'), proxies.iraqMilitias.strikesLaunched),
        this.buildMetric(t('panels.basesTargeted'), proxies.iraqMilitias.basesTargeted),
      ),
    );

    toggleBtn.addEventListener('click', () => {
      this.proxiesExpanded = !this.proxiesExpanded;
      this.render();
    });

    return h('div', { className: 'scorecard-proxies' },
      toggleBtn,
      proxyContent,
    );
  }

  private render(): void {
    if (!this.data) {
      replaceChildren(this.content, h('div', { className: 'empty-state' }, t('panels.noScorecardData')));
      return;
    }
    this.setErrorState(false);

    const container = h('div', { className: 'scorecard-container' },
      // Baseline label
      h('div', { className: 'scorecard-baseline-label' },
        t('panels.scorecardBaseline'),
      ),
      // Main Iran vs Israel
      h('div', { className: 'scorecard-sides' },
        this.buildSide(t('panels.iran'), '🇮🇷', this.data.iran),
        h('div', { className: 'scorecard-divider' }),
        this.buildSide(t('panels.israel'), '🇮🇱', this.data.israel),
      ),
      // Shared impact
      this.buildShared(this.data.shared),
      // Proxy forces (expandable)
      ...(this.data.proxies ? [this.buildProxies(this.data.proxies)] : []),
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
