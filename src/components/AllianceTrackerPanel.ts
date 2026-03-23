import { Panel } from './Panel';
import { h, replaceChildren } from '@/utils/dom-utils';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';

type AllianceSide = 'pro-iran' | 'neutral' | 'pro-israel';
type Strength = 'strong' | 'moderate' | 'cautious';

export interface AlliancePosition {
  country: string;
  flag: string;
  side: AllianceSide;
  strength: Strength;
  label: string;
  actions: string[];
}

const STRENGTH_PERCENT: Record<Strength, number> = { strong: 100, moderate: 50, cautious: 25 };
const STRENGTH_COLORS: Record<Strength, string> = { strong: '#ff4444', moderate: '#ffaa00', cautious: '#44aa44' };

export class AllianceTrackerPanel extends Panel {
  private positions: AlliancePosition[] = [];

  constructor() {
    super({
      id: 'alliance-tracker',
      title: t('panels.allianceTracker'),
      infoTooltip: t('panels.allianceTrackerTooltip'),
      showCount: true,
      defaultRowSpan: 2,
    });
    this.showLoading(t('common.loading'));
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    try {
      const res = await fetch('/data/alliance-positions.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data?.positions && Array.isArray(data.positions)) {
        this.positions = data.positions;
        this.render();
      }
    } catch {
      if (this.positions.length === 0) {
        this.showError(t('panels.allianceTrackerError'), () => void this.fetchData());
      }
    }
  }

  private buildCountryCard(pos: AlliancePosition): HTMLElement {
    const strengthColor = STRENGTH_COLORS[pos.strength] || STRENGTH_COLORS.cautious;
    const strengthPct = STRENGTH_PERCENT[pos.strength] || 25;

    const actionItems = pos.actions.slice(0, 3).map(a =>
      h('li', { className: 'alliance-action' }, escapeHtml(a)));

    return h('div', { className: 'alliance-card' },
      h('div', { className: 'alliance-card-header' },
        h('span', { className: 'alliance-flag' }, pos.flag),
        h('div', { className: 'alliance-card-info' },
          h('span', { className: 'alliance-country' }, escapeHtml(pos.country)),
          h('span', { className: 'alliance-label' }, escapeHtml(pos.label)),
        ),
      ),
      h('div', { className: 'alliance-strength' },
        h('div', { className: 'alliance-strength-bar' },
          h('div', { className: 'alliance-strength-fill', style: `width:${strengthPct}%;background:${strengthColor};` }),
        ),
        h('span', { className: 'alliance-strength-label' }, pos.strength),
      ),
      h('ul', { className: 'alliance-actions' }, ...actionItems),
    );
  }

  private buildSection(title: string, className: string, items: AlliancePosition[]): HTMLElement {
    return h('div', { className: `alliance-section ${className}` },
      h('div', { className: 'alliance-section-header' }, title),
      h('div', { className: 'alliance-section-cards' },
        ...items.map(p => this.buildCountryCard(p)),
      ),
    );
  }

  private render(): void {
    this.setCount(this.positions.length);
    this.setErrorState(false);

    if (this.positions.length === 0) {
      replaceChildren(this.content, h('div', { className: 'empty-state' }, t('panels.noAllianceData')));
      return;
    }

    const proIran = this.positions.filter(p => p.side === 'pro-iran');
    const neutral = this.positions.filter(p => p.side === 'neutral');
    const proIsrael = this.positions.filter(p => p.side === 'pro-israel');

    replaceChildren(this.content,
      h('div', { className: 'alliance-container' },
        this.buildSection(`🇮🇷 ${t('panels.proIran')}`, 'alliance-section--iran', proIran),
        this.buildSection(`🌐 ${t('panels.neutralMediating')}`, 'alliance-section--neutral', neutral),
        this.buildSection(`🇮🇱 ${t('panels.proIsrael')}`, 'alliance-section--israel', proIsrael),
      ),
    );
  }

  public update(positions: AlliancePosition[]): void {
    this.positions = positions;
    this.render();
  }
}
