import { useEffect, useRef, useState } from 'react';

// The interface's own slider and dropdown, drawn with the current palette
// in place of the browser's built-in ones.

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label?: string;
}

/** A horizontal slider: drag anywhere on it, or use the arrow keys. */
export function Slider({ value, min, max, step, onChange, label }: SliderProps) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

  const snap = (raw: number): number => {
    const stepped = min + Math.round((raw - min) / step) * step;
    // Rounded so repeated steps do not pick up floating-point crumbs.
    return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
  };
  const setFromPointer = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const next = snap(min + ((clientX - box.left) / box.width) * (max - min));
    if (next !== value) onChange(next);
  };

  return (
    <div
      ref={track}
      className="slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      onPointerDown={(event) => {
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (dragging.current) setFromPointer(event.clientX);
      }}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
      onKeyDown={(event) => {
        const big = (max - min) / 10;
        const change =
          event.key === 'ArrowRight' || event.key === 'ArrowUp'
            ? step
            : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
              ? -step
              : event.key === 'PageUp'
                ? big
                : event.key === 'PageDown'
                  ? -big
                  : 0;
        if (change === 0) return;
        event.preventDefault();
        onChange(snap(value + change));
      }}
    >
      <div className="slider-fill" style={{ width: `${fraction * 100}%` }} />
      <div className="slider-thumb" style={{ left: `${fraction * 100}%` }} />
    </div>
  );
}

interface DropdownProps {
  /** The chosen option's value. With a placeholder, the list is a menu of actions and nothing stays chosen. */
  value?: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}

/** A dropdown list: click to open, click an option to choose it. */
export function Dropdown({ value, options, onChange, placeholder, label, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const chosen = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Arrow keys on the closed button step through the options. */
  const stepBy = (change: number) => {
    if (placeholder !== undefined || options.length === 0) return;
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    const next = options[Math.min(options.length - 1, Math.max(0, index + change))];
    if (next.value !== value) onChange(next.value);
  };

  return (
    <div ref={root} className={`dropdown${className ? ` ${className}` : ''}${open ? ' open' : ''}`}>
      <button
        type="button"
        className="dropdown-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (open) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            stepBy(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            stepBy(-1);
          }
        }}
      >
        <span>{placeholder ?? chosen?.label ?? ''}</span>
        <span className="dropdown-arrow" aria-hidden="true" />
      </button>
      {open && (
        <ul className="dropdown-list" role="listbox">
          {options.map((option) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                className={option.value === value && placeholder === undefined ? 'selected' : ''}
                onClick={() => {
                  setOpen(false);
                  onChange(option.value);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
