import type { CSSProperties } from 'react';
import { cleanNameStyle, gradientAt, type NameStyleFields } from '../pass/nameStyle';

/**
 * A player's name drawn with a name color cosmetic: its color or gradient, its
 * outline or glow, and its animation. Without a style, the name as it is.
 */
export function StyledName({ text, style: fields }: { text: string; style?: NameStyleFields | null }) {
  if (!fields) return <span>{text}</span>;
  const style = cleanNameStyle(fields);
  const { colors, outline, edge, effect, speed } = style;
  const css: CSSProperties & Record<'--name-speed', string> = { fontWeight: 700, '--name-speed': `${speed}s` };

  // The edge goes on as shadows of the drawn letters, so it sits outside them
  // and never covers a gradient.
  if (outline) {
    css.filter =
      edge === 'glow'
        ? `drop-shadow(0 0 0.12em ${outline}) drop-shadow(0 0 0.25em ${outline})`
        : `drop-shadow(1px 0 0 ${outline}) drop-shadow(-1px 0 0 ${outline}) drop-shadow(0 1px 0 ${outline}) drop-shadow(0 -1px 0 ${outline})`;
  }

  // Chase lights each letter in turn, each in its own place along the gradient.
  if (effect === 'chase') {
    const letters = [...text];
    return (
      <span className="styled-name name-chase" style={css} aria-label={text}>
        {letters.map((letter, i) => (
          <span
            key={i}
            aria-hidden
            style={{
              color: gradientAt(colors, letters.length > 1 ? i / (letters.length - 1) : 0),
              animationDelay: `${((i / letters.length) * speed * 0.8).toFixed(3)}s`,
            }}
          >
            {letter === ' ' ? ' ' : letter}
          </span>
        ))}
      </span>
    );
  }

  const layers: string[] = [];
  const sizes: string[] = [];
  if (effect === 'glare') {
    layers.push('linear-gradient(110deg, transparent 40%, rgba(255, 255, 255, 0.9) 50%, transparent 60%)');
    sizes.push('300% 100%');
  }
  if (colors.length > 1 || layers.length > 0) {
    layers.push(colors.length > 1 ? `linear-gradient(90deg, ${colors.join(', ')})` : `linear-gradient(${colors[0]}, ${colors[0]})`);
    sizes.push('100% 100%');
    css.backgroundImage = layers.join(', ');
    css.backgroundSize = sizes.join(', ');
    css.backgroundRepeat = 'no-repeat';
    css.WebkitBackgroundClip = 'text';
    css.backgroundClip = 'text';
    css.color = 'transparent';
    css.WebkitTextFillColor = 'transparent';
  } else {
    css.color = colors[0];
  }

  return (
    <span className={`styled-name${effect === 'none' ? '' : ` name-${effect}`}`} style={css}>
      {text}
    </span>
  );
}
