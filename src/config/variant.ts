const VALID_VARIANTS = ['full', 'tech', 'finance', 'happy', 'commodity', 'mena'] as const;
type Variant = (typeof VALID_VARIANTS)[number];

const isValidVariant = (v: string | null): v is Variant =>
  v != null && (VALID_VARIANTS as readonly string[]).includes(v);

const buildVariant = (() => {
  try {
    const env = import.meta.env?.VITE_VARIANT;
    return isValidVariant(env) ? env : 'mena';
  } catch {
    return 'mena';
  }
})();

export const SITE_VARIANT: string = (() => {
  if (typeof window === 'undefined') return buildVariant;

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  if (isTauri) {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (isValidVariant(stored)) return stored;
    return buildVariant;
  }

  const h = location.hostname;
  if (h.startsWith('mena.')) return 'mena';
  if (h.startsWith('tech.')) return 'tech';
  if (h.startsWith('finance.')) return 'finance';
  if (h.startsWith('happy.')) return 'happy';
  if (h.startsWith('commodity.')) return 'commodity';

  if (h === 'localhost' || h === '127.0.0.1') {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (isValidVariant(stored)) return stored;
    return buildVariant;
  }

  return 'mena';
})();
