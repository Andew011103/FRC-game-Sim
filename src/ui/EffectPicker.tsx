import { ALLIANCE_COLOR, EFFECT_SCALES, PIECE_EFFECTS, effectScales, type PieceEffect } from '../pass/effects';
import { useGame } from './store';

/** A small ball showing a game piece effect, animated with the page's own styles. */
export function EffectPreview({ effect }: { effect: PieceEffect }) {
  const alliance = useGame((state) => state.alliance);
  const color = effect.color === ALLIANCE_COLOR ? (alliance === 'red' ? '#e5484d' : '#2f6fed') : effect.color;
  const scales = effectScales(effect);
  return (
    <span className="pass-preview pass-piece-stage" aria-label={`${effect.kind} effect`}>
      <i
        className={`pass-piece pass-piece-${effect.kind}`}
        style={
          {
            // As in a match: the fuel takes on its share of the colour, and the glow is as bright as set.
            '--piece': `color-mix(in srgb, ${color} ${Math.round(scales.fuelColor * 100)}%, #f5d33b)`,
            '--halo': `color-mix(in srgb, ${color} ${Math.round(Math.min(1, scales.glow) * 100)}%, transparent)`,
          } as React.CSSProperties
        }
      />
    </span>
  );
}

/** Choosing a game piece effect and its colour. With `optional`, it can be left with none. */
export function EffectPicker({
  value,
  onChange,
  optional = false,
}: {
  value: PieceEffect | undefined;
  onChange: (effect: PieceEffect | undefined) => void;
  optional?: boolean;
}) {
  const alliance = value?.color === ALLIANCE_COLOR;
  return (
    <div className="pass-tier-row">
      <label>
        Game piece effect
        <select
          value={value?.kind ?? ''}
          onChange={(event) =>
            onChange(event.target.value ? { kind: event.target.value, color: value?.color ?? ALLIANCE_COLOR } : undefined)
          }
        >
          {optional && <option value="">None</option>}
          {PIECE_EFFECTS.map((effect) => (
            <option key={effect.value} value={effect.value}>
              {effect.label}
            </option>
          ))}
        </select>
      </label>
      {value && (
        <>
          <label className="pass-check">
            <input type="checkbox" checked={alliance} onChange={(event) => onChange({ ...value, color: event.target.checked ? ALLIANCE_COLOR : '#ff3b3b' })} />
            Alliance colour
          </label>
          {!alliance && (
            <label>
              Colour
              <input type="color" value={value.color} onChange={(event) => onChange({ ...value, color: event.target.value })} />
            </label>
          )}
          {EFFECT_SCALES.map((scale) => {
            const current = value[scale.key] ?? scale.default;
            return (
              <label key={scale.key}>
                {scale.label}: {Math.round(current * 100)}%
                <input
                  type="range"
                  min={scale.min}
                  max={scale.max}
                  step={scale.step}
                  value={current}
                  onChange={(event) => onChange({ ...value, [scale.key]: Number(event.target.value) })}
                />
              </label>
            );
          })}
          <EffectPreview effect={value} />
        </>
      )}
    </div>
  );
}
