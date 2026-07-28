import { describe, it, expect } from 'vitest';
import { buildCSSVars, pct } from '../src/utils';

describe('buildCSSVars', () => {
  it('uses defaults when no theme provided', () => {
    const vars = buildCSSVars();
    expect(vars['--pdx-primary' as never]).toBe('#6366f1');
    expect(vars['--pdx-bg' as never]).toBe('#ffffff');
  });

  it('applies dark mode', () => {
    const vars = buildCSSVars({ mode: 'dark' });
    expect(vars['--pdx-bg' as never]).toBe('#1a1a2e');
  });

  it('applies custom primary color', () => {
    const vars = buildCSSVars({ primaryColor: '#ff0000' });
    expect(vars['--pdx-primary' as never]).toBe('#ff0000');
  });

  it('applies custom border radius', () => {
    const vars = buildCSSVars({ borderRadius: 8 });
    expect(vars['--pdx-radius' as never]).toBe('8px');
  });
});

describe('pct', () => {
  it('returns 50% when both sides equal', () => {
    expect(pct(50, 50)).toBe('50%');
  });

  it('returns 50% when total is 0', () => {
    expect(pct(0, 0)).toBe('50%');
  });

  it('returns 100% when all on one side', () => {
    expect(pct(100, 0)).toBe('100%');
    expect(pct(0, 100)).toBe('0%');
  });

  it('rounds to nearest integer', () => {
    expect(pct(1, 2)).toBe('33%');
  });
});
