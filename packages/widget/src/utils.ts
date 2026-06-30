import type { WidgetTheme } from './types';

export function buildCSSVars(theme: WidgetTheme = {}): React.CSSProperties {
  const {
    primaryColor = '#6366f1',
    mode = 'light',
    borderRadius = 16,
    fontFamily = 'system-ui, sans-serif',
  } = theme;

  const isDark = mode === 'dark';

  return {
    '--pdx-primary': primaryColor,
    '--pdx-bg': isDark ? '#1a1a2e' : '#ffffff',
    '--pdx-surface': isDark ? '#16213e' : '#f8f9fa',
    '--pdx-text': isDark ? '#e2e8f0' : '#1e293b',
    '--pdx-muted': isDark ? '#94a3b8' : '#64748b',
    '--pdx-border': isDark ? '#334155' : '#e2e8f0',
    '--pdx-radius': `${borderRadius}px`,
    '--pdx-font': fontFamily,
  } as React.CSSProperties;
}

export function pct(a: number, b: number): string {
  const total = a + b;
  if (total === 0) return '50%';
  return `${Math.round((a / total) * 100)}%`;
}
