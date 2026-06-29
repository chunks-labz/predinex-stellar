import { describe, it, expect } from 'vitest';
import manifest from '../../app/manifest';

describe('web app manifest', () => {
  const result = manifest();

  it('declares the installability essentials', () => {
    expect(result.name).toContain('Predinex');
    expect(result.short_name).toBe('Predinex');
    expect(result.start_url).toBe('/');
    expect(result.display).toBe('standalone');
  });

  it('sets theme and background colors', () => {
    expect(result.theme_color).toBe('#8b5cf6');
    expect(result.background_color).toBe('#050505');
  });

  it('includes 192px and 512px PNG icons plus a maskable variant', () => {
    const icons = result.icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');

    expect(icons.every((icon) => icon.type === 'image/png')).toBe(true);
    expect(icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    expect(icons.some((icon) => icon.purpose === 'any')).toBe(true);
  });
});
