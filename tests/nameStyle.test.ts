import { describe, expect, it } from 'vitest';
import { MAX_GRADIENT, NAME_SPEED, cleanNameStyle, describeNameStyle, gradientAt } from '../src/pass/nameStyle';

describe('name styles', () => {
  it('reads an old plain name color as that color, with nothing else', () => {
    const style = cleanNameStyle({ color: '#ffcc00' });
    expect(style).toEqual({ colors: ['#ffcc00'], outline: '', edge: 'line', effect: 'none', speed: NAME_SPEED.start });
    expect(describeNameStyle(style)).toBe('');
  });

  it('keeps only real colors, a few gradient colors, and known effects', () => {
    const style = cleanNameStyle({
      color: 'red; background: url(x)',
      gradient: ['#111111', 'nope', '#222222', '#333333', '#444444', '#555555'],
      outline: '#000000',
      edge: 'sparkle' as never,
      effect: 'explode' as never,
      speed: 99,
    });
    expect(style.colors[0]).toBe('#ffffff');
    expect(style.colors).toHaveLength(1 + MAX_GRADIENT);
    expect(style.colors).not.toContain('nope');
    expect(style.edge).toBe('line');
    expect(style.effect).toBe('none');
    expect(style.speed).toBe(NAME_SPEED.most);
  });

  it('describes what a style has', () => {
    const style = cleanNameStyle({ color: '#ff0000', gradient: ['#0000ff'], outline: '#ffffff', edge: 'glow', effect: 'chase' });
    expect(describeNameStyle(style)).toBe('2-color gradient, glow, chase');
  });

  it('finds colors along a gradient', () => {
    expect(gradientAt(['#000000', '#ffffff'], 0)).toBe('#000000');
    expect(gradientAt(['#000000', '#ffffff'], 1)).toBe('#ffffff');
    expect(gradientAt(['#000000', '#ffffff'], 0.5)).toBe('#808080');
    expect(gradientAt(['#ff0000', '#00ff00', '#0000ff'], 0.5)).toBe('#00ff00');
    expect(gradientAt(['#123456'], 0.7)).toBe('#123456');
  });
});
